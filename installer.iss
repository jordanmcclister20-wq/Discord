; ============================================================
;  Discord Overlay — Inno Setup 6 Installer Script
;  Build the Electron app first:
;    npm install && npm run dist
;  This produces dist\win-unpacked\ — then compile this .iss.
; ============================================================

#define AppName        "Discord Overlay"
#define AppVersion     "2.1.1"
#define AppPublisher   "Discord Overlay"
#define AppId          "com.discord.overlay"
#define AppExeName     "Discord Overlay.exe"
#define AppDescription "Drop-down Discord overlay for your desktop"

; Adjust this path to wherever electron-builder put the unpacked output
#define BuildDir       "dist\win-unpacked"

[Setup]
AppId                    = {{{#AppId}}
AppName                  = {#AppName}
AppVersion               = {#AppVersion}
AppPublisher             = {#AppPublisher}
AppPublisherURL          = https://github.com/
AppSupportURL            = https://github.com/
AppUpdatesURL            = https://github.com/
VersionInfoVersion       = {#AppVersion}
VersionInfoDescription   = {#AppDescription}
VersionInfoProductName   = {#AppName}

; Install into per-user AppData so no UAC prompt is needed
DefaultDirName           = {localappdata}\{#AppName}
DefaultGroupName         = {#AppName}
DisableProgramGroupPage  = yes
PrivilegesRequired       = lowest
PrivilegesRequiredOverridesAllowed = dialog

; Paths
OutputDir                = dist\installer
OutputBaseFilename       = DiscordOverlay-Setup-{#AppVersion}
SetupIconFile            = assets\icon.ico

Compression              = lzma2/ultra64
SolidCompression         = yes
InternalCompressLevel    = ultra64

; Windows 10+ only (Electron 28 requirement)
MinVersion               = 10.0.17763

; Appearance
WizardStyle              = modern
DisableWelcomePage       = no

; Uninstall
UninstallDisplayIcon     = {app}\{#AppExeName}
UninstallDisplayName     = {#AppName}
CreateUninstallRegKey    = yes

; Allow only one instance of the installer to run at a time
AppMutex                 = DiscordOverlaySetupMutex

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon";    Description: "{cm:CreateDesktopIcon}";    GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startupentry";   Description: "Start Discord Overlay when Windows starts"; GroupDescription: "Startup:"; Flags: unchecked

[Files]
; ── Main app bundle (everything electron-builder put in win-unpacked) ──────────
Source: "{#BuildDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; ── Icon asset (for shortcuts / taskbar) ──────────────────────────────────────
Source: "assets\icon.ico";  DestDir: "{app}\assets"; Flags: ignoreversion

[Icons]
; Start Menu
Name: "{group}\{#AppName}";          Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\assets\icon.ico"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

; Desktop shortcut (optional task)
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\assets\icon.ico"; Tasks: desktopicon

[Registry]
; Add/Remove Programs entry with custom icon
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppId}_is1"; \
    ValueType: string; ValueName: "DisplayIcon"; ValueData: "{app}\assets\icon.ico"; \
    Flags: uninsdeletevalue

; Windows startup entry (optional task)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
    ValueType: string; ValueName: "{#AppName}"; ValueData: """{app}\{#AppExeName}"""; \
    Tasks: startupentry; Flags: uninsdeletevalue

[Run]
; Launch after install (don't wait for it to exit)
Filename: "{app}\{#AppExeName}"; \
    Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; \
    Flags: nowait postinstall skipifsilent

[UninstallRun]
; Kill the running process before uninstalling so files aren't locked
Filename: "taskkill.exe"; Parameters: "/f /im ""{#AppExeName}"""; \
    Flags: runhidden skipifdoesnotexist; RunOnceId: "KillOverlay"

[Code]
// ── Kill any running instance before the installer modifies files ─────────────
procedure KillRunningInstance();
var
  ResultCode: Integer;
begin
  Exec('taskkill.exe', '/f /im "' + '{#AppExeName}' + '"', '', SW_HIDE,
       ewWaitUntilTerminated, ResultCode);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  KillRunningInstance();
  Result := '';
end;

// ── Prevent downgrading ───────────────────────────────────────────────────────
function InitializeSetup(): Boolean;
var
  InstalledVer, CurrentVer: String;
begin
  Result := True;
  if RegQueryStringValue(HKCU,
      'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppId}_is1',
      'DisplayVersion', InstalledVer) then
  begin
    CurrentVer := '{#AppVersion}';
    if CompareStr(InstalledVer, CurrentVer) > 0 then
    begin
      MsgBox('A newer version (' + InstalledVer + ') is already installed. ' +
             'Please uninstall it first.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;
