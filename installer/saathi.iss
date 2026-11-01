#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6F1B6F5C-3E1A-4C4B-9D7A-5A7A1E2B5A11}
AppName=Saathi
AppVersion={#AppVersion}
AppVerName=Saathi {#AppVersion}
AppPublisher=Akshat Sarkar
AppPublisherURL=https://github.com/akshatinnovate-png/Saathi-Alexa
AppSupportURL=https://github.com/akshatinnovate-png/Saathi-Alexa/issues
AppUpdatesURL=https://github.com/akshatinnovate-png/Saathi-Alexa/releases
DefaultDirName={localappdata}\Programs\Saathi
DefaultGroupName=Saathi
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\build\out
OutputBaseFilename=Saathi-Setup-{#AppVersion}
SetupIconFile=saathi.ico
UninstallDisplayIcon={app}\saathi.ico
UninstallDisplayName=Saathi
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
LicenseFile=..\LICENSE
VersionInfoVersion={#AppVersion}
VersionInfoDescription=Saathi installer

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Put a Saathi icon on the desktop"; GroupDescription: "Shortcuts:"
Name: "autostart"; Description: "Start Saathi when I sign in to Windows (recommended, so reminders and help calls always work)"; GroupDescription: "Start-up:"

[Files]
Source: "..\build\windows\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Saathi"; Filename: "{app}\saathi.exe"; IconFilename: "{app}\saathi.ico"; Comment: "Open Saathi"
Name: "{group}\Stop Saathi"; Filename: "{app}\saathi.exe"; Parameters: "--stop"; IconFilename: "{app}\saathi.ico"
Name: "{group}\Lock the key into this computer"; Filename: "{app}\saathi.exe"; Parameters: "--protect-key"; IconFilename: "{app}\saathi.ico"
Name: "{group}\Restore the key from a recovery key"; Filename: "{app}\saathi.exe"; Parameters: "--restore-key"; IconFilename: "{app}\saathi.ico"
Name: "{group}\Reach Saathi from anywhere"; Filename: "{app}\saathi.exe"; Parameters: "--reach"; IconFilename: "{app}\saathi.ico"
Name: "{group}\Where is my key?"; Filename: "{app}\saathi.exe"; Parameters: "--key-status"; IconFilename: "{app}\saathi.ico"
Name: "{group}\Saathi data folder"; Filename: "{localappdata}\Saathi"
Name: "{group}\Uninstall Saathi"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Saathi"; Filename: "{app}\saathi.exe"; IconFilename: "{app}\saathi.ico"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Saathi"; ValueData: """{app}\saathi.exe"" --background"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\saathi.exe"; Description: "Open Saathi now"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{app}\saathi.exe"; Parameters: "--stop"; RunOnceId: "StopSaathi"; Flags: runhidden waituntilterminated

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\saathi.exe')) then
    Exec(ExpandConstant('{app}\saathi.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and not UninstallSilent then
    SuppressibleMsgBox('Saathi was removed. The family''s data is still in ' + ExpandConstant('{localappdata}\Saathi') + ', so nothing is lost if you install it again. Delete that folder yourself only if you are sure.', mbInformation, MB_OK, IDOK);
end;
