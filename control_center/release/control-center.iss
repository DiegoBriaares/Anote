#define ProductName "Anote Control Center"
#ifndef ProductVersion
  #error ProductVersion must be supplied by the build script.
#endif
#ifndef SourceDirectory
  #error SourceDirectory must be supplied by the build script.
#endif
#ifndef OutputDirectory
  #error OutputDirectory must be supplied by the build script.
#endif
#ifndef IconFile
  #error IconFile must be supplied by the build script.
#endif

[Setup]
AppId={{BB9972F8-AE2F-48C0-A4D6-52A4062D9B70}
AppName={#ProductName}
AppVersion={#ProductVersion}
AppPublisher=Anote
DefaultDirName={localappdata}\Programs\{#ProductName}
DefaultGroupName={#ProductName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
MinVersion=10.0.22000
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDirectory}
OutputBaseFilename=Anote-Control-Center-Windows11-x64-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#ProductName}
UninstallDisplayIcon={app}\{#ProductName}.exe
CloseApplications=yes
RestartApplications=no
SetupLogging=yes
SetupIconFile={#IconFile}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
Source: "{#SourceDirectory}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#ProductName}"; Filename: "{app}\{#ProductName}.exe"; IconFilename: "{app}\AnoteControlCenter.ico"
Name: "{userdesktop}\{#ProductName}"; Filename: "{app}\{#ProductName}.exe"; IconFilename: "{app}\AnoteControlCenter.ico"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Run]
Filename: "{app}\{#ProductName}.exe"; Description: "{cm:LaunchProgram,{#StringChange(ProductName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
