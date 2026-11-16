; Teach me 安装器扩展（electron-builder nsis.include）
;
; 干的事：在"选择安装位置"之后插一页「选择附加任务」，让用户勾
; 「在桌面创建快捷方式」，默认勾上；不勾就什么也不放。
;
; 为什么不用 builder.json 的 createDesktopShortcut：
;   那个开关只会"总是创建"或"从不创建"，没有勾选框。所以这里
;   createDesktopShortcut 设成 false（顺手 define 了
;   DO_NOT_CREATE_DESKTOP_SHORTCUT，官方逻辑不会插一脚），
;   快捷方式由本文件在 customInstall 里自己建、自己删。
;
; 可用变量（由 electron-builder 注入）：$appExe、${SHORTCUT_NAME}、
; ${APP_ID}、${APP_DESCRIPTION}、$DESKTOP、$INSTDIR。
;
; 注意：electron-builder 会用同一份脚本编译两遍——先 BUILD_UNINSTALLER，
; 再编译安装器。所以页面和安装相关的部分要包在 !ifndef BUILD_UNINSTALLER
; 里面，否则卸载器那一遍会报 6010（函数没人引用的警告，被 -WX 当错误）。

!include "LogicLib.nsh"
!include "nsDialogs.nsh"
; 这个文件被 electron-builder 拼在模板**之前**，所以 MUI 的宏此刻还没定义。
; 提前引一次（MUI2 自带 MUI_INCLUDED 保护，模板里再 include 不会重复定义）。
!include "MUI2.nsh"

!ifndef BUILD_UNINSTALLER

  ; 0 = 不建，1 = 建。默认 1：大多数人是想要的。
  Var DesktopShortcutCheckBox
  Var DesktopShortcutState

  ; ── 一页：选择附加任务（选完安装目录之后、真正开始装之前）──

  !macro customPageAfterChangeDir
    Page custom TeachMeExtrasPageCreate TeachMeExtrasPageLeave
  !macroend

  Function TeachMeExtrasPageCreate
    ; 静默安装不动界面，按默认值走
    ${If} ${Silent}
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "选择附加任务" "还差一步：要不要在桌面上放个图标？"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0 0 100% 14u "在桌面创建「${SHORTCUT_NAME}」快捷方式"
    Pop $DesktopShortcutCheckBox
    ${If} $DesktopShortcutState == "0"
      ${NSD_SetState} $DesktopShortcutCheckBox ${BST_UNCHECKED}
    ${Else}
      ${NSD_SetState} $DesktopShortcutCheckBox ${BST_CHECKED}
    ${EndIf}

    ${NSD_CreateLabel} 14u 22u 100% 46u "勾上就在桌面放一个图标，双击直接开课。$\r$\n不勾也没关系：开始菜单里照样能找到它，随时可以自己拖一个到桌面。"
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function TeachMeExtrasPageLeave
    ${NSD_GetState} $DesktopShortcutCheckBox $DesktopShortcutState
    ${If} $DesktopShortcutState == ${BST_CHECKED}
      StrCpy $DesktopShortcutState "1"
    ${Else}
      StrCpy $DesktopShortcutState "0"
    ${EndIf}
  FunctionEnd

  ; ── 装完之后按用户的选择落快捷方式 ──

  !macro customInstall
    ${If} $DesktopShortcutState == "1"
      CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      ; 让任务栏认出这是同一个应用，而不是一个陌生 lnk
      WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    ${Else}
      Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${EndIf}
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  !macroend

!endif

; 卸载时把桌面那个也带走（官方因为 DO_NOT_CREATE_DESKTOP_SHORTCUT 已经不删了）
; 这一段要在卸载器那一遍也编进去，所以放在 !ifndef 外面。
!macro customUnInstall
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
!macroend
