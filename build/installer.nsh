; NeuralUpscale NSIS customizations
; - Prerequisites page: desktop shortcut + VC++ Redistributable
; - Downloads/installs VC++ 2015–2022 (x64) when selected and missing

!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
  Var CreateDesktopShortcut
  Var InstallVCRedist
  Var VCRedistAlreadyInstalled
  Var Dialog
  Var CheckboxDesktop
  Var CheckboxVC

  !define VCREDIST_URL "https://aka.ms/vs/17/release/vc_redist.x64.exe"

  ; Detect Microsoft Visual C++ 2015–2022 Redistributable (x64).
  Function DetectVCRedist
    StrCpy $VCRedistAlreadyInstalled "0"

    ; App ships x64-only — always read the 64-bit registry view.
    SetRegView 64

    ClearErrors
    ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    IntCmp $0 1 vcredist_found 0 0
    ClearErrors
    ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Installed"
    IntCmp $0 1 vcredist_found 0 0
    Goto vcredist_done

    vcredist_found:
      StrCpy $VCRedistAlreadyInstalled "1"

    vcredist_done:
      SetRegView lastused
  FunctionEnd

  !macro customInit
    StrCpy $CreateDesktopShortcut "1"
    StrCpy $InstallVCRedist "1"
    Call DetectVCRedist
    StrCmp $VCRedistAlreadyInstalled "1" 0 +2
      StrCpy $InstallVCRedist "0"
  !macroend

  ; Page + UI functions live in this macro so they expand after MUI2 is included.
  !macro customPageAfterChangeDir
    Page custom PrerequisitesPageCreate PrerequisitesPageLeave

    Function PrerequisitesPageCreate
      !insertmacro MUI_HEADER_TEXT "Additional options" "Choose shortcuts and runtime components."

      nsDialogs::Create 1018
      Pop $Dialog
      StrCmp $Dialog "error" 0 +2
        Abort

      ${NSD_CreateLabel} 0 0 100% 24u "NeuralUpscale uses Vulkan, CUDA, and TensorRT components that may require the Microsoft Visual C++ 2015–2022 Redistributable (x64)."
      Pop $0

      ${NSD_CreateCheckbox} 0 36u 100% 12u "Create a desktop shortcut"
      Pop $CheckboxDesktop
      StrCmp $CreateDesktopShortcut "1" 0 +2
        ${NSD_Check} $CheckboxDesktop

      StrCmp $VCRedistAlreadyInstalled "1" vcredist_ui_installed vcredist_ui_missing

      vcredist_ui_installed:
        ${NSD_CreateCheckbox} 0 56u 100% 12u "Microsoft Visual C++ 2015–2022 Redistributable (x64) — Already installed"
        Pop $CheckboxVC
        ${NSD_Check} $CheckboxVC
        EnableWindow $CheckboxVC 0
        Goto vcredist_ui_done

      vcredist_ui_missing:
        ${NSD_CreateCheckbox} 0 56u 100% 24u "Download and install Microsoft Visual C++ 2015–2022 Redistributable (x64)"
        Pop $CheckboxVC
        StrCmp $InstallVCRedist "1" 0 +2
          ${NSD_Check} $CheckboxVC

      vcredist_ui_done:
        ${NSD_CreateLabel} 0 90u 100% 36u "If the redistributable is not already present, it will be downloaded from Microsoft during installation (internet connection required)."
        Pop $0
        nsDialogs::Show
    FunctionEnd

    Function PrerequisitesPageLeave
      ${NSD_GetState} $CheckboxDesktop $0
      StrCmp $0 ${BST_CHECKED} 0 +3
        StrCpy $CreateDesktopShortcut "1"
        Goto +2
      StrCpy $CreateDesktopShortcut "0"

      StrCmp $VCRedistAlreadyInstalled "1" 0 +3
        StrCpy $InstallVCRedist "0"
        Goto +5
      ${NSD_GetState} $CheckboxVC $0
      StrCmp $0 ${BST_CHECKED} 0 +3
        StrCpy $InstallVCRedist "1"
        Goto +2
      StrCpy $InstallVCRedist "0"
    FunctionEnd
  !macroend

  !macro customInstall
    ; Honor desktop shortcut choice (electron-builder creates it by default).
    StrCmp $CreateDesktopShortcut "1" skip_remove_desktop
      IfFileExists "$newDesktopLink" 0 skip_remove_desktop
        WinShell::UninstShortcut "$newDesktopLink"
        Delete "$newDesktopLink"
    skip_remove_desktop:

    ; Download + install VC++ when requested and missing.
    StrCmp $InstallVCRedist "1" 0 skip_vcredist
    StrCmp $VCRedistAlreadyInstalled "1" skip_vcredist

      DetailPrint "Downloading Microsoft Visual C++ 2015–2022 Redistributable (x64)..."
      inetc::get /CAPTION "Downloading VC++ Redistributable" \
        /BANNER "Microsoft Visual C++ 2015–2022 Redistributable (x64)$\r$\nFrom Microsoft" \
        /USERAGENT "NeuralUpscale-Installer" \
        /CONNECTTIMEOUT 15000 /RECEIVETIMEOUT 60000 \
        "${VCREDIST_URL}" "$PLUGINSDIR\vc_redist.x64.exe" /END
      Pop $0

      StrCmp $0 "OK" vcredist_download_ok
        inetc::get /NOPROXY /CAPTION "Downloading VC++ Redistributable" \
          /BANNER "Microsoft Visual C++ 2015–2022 Redistributable (x64)$\r$\nFrom Microsoft" \
          /USERAGENT "NeuralUpscale-Installer" \
          "${VCREDIST_URL}" "$PLUGINSDIR\vc_redist.x64.exe" /END
        Pop $0

      vcredist_download_ok:
      StrCmp $0 "OK" 0 vcredist_download_fail
        DetailPrint "Installing Microsoft Visual C++ Redistributable..."
        ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart' $1
        StrCmp $1 "0" vcredist_ok
        StrCmp $1 "1638" vcredist_newer
        StrCmp $1 "3010" vcredist_reboot
          DetailPrint "Visual C++ Redistributable installer returned code $1."
          MessageBox MB_ICONEXCLAMATION|MB_OK "Microsoft Visual C++ Redistributable installation returned code $1.$\r$\n$\r$\nNeuralUpscale was installed, but GPU backends may fail until the redistributable is installed.$\r$\n$\r$\nDownload: ${VCREDIST_URL}"
          Goto vcredist_cleanup
        vcredist_ok:
          DetailPrint "Visual C++ Redistributable installed successfully."
          Goto vcredist_cleanup
        vcredist_newer:
          DetailPrint "A newer Visual C++ Redistributable is already installed."
          Goto vcredist_cleanup
        vcredist_reboot:
          DetailPrint "Visual C++ Redistributable installed (reboot may be required)."
          Goto vcredist_cleanup
        vcredist_cleanup:
          Delete "$PLUGINSDIR\vc_redist.x64.exe"
          Goto skip_vcredist

      vcredist_download_fail:
        DetailPrint "Failed to download Visual C++ Redistributable (status: $0)."
        MessageBox MB_ICONEXCLAMATION|MB_OK "Could not download Microsoft Visual C++ 2015–2022 Redistributable.$\r$\nStatus: $0$\r$\n$\r$\nNeuralUpscale was installed, but GPU backends may fail until you install it manually:$\r$\n${VCREDIST_URL}"

    skip_vcredist:
  !macroend
!endif
