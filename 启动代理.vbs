' ============================================================
'  Xifan Workbench - Local CORS Proxy Launcher (silent)
'  Double-click this file to start the local proxy in background
'  (no black window). On first run it adds itself to Windows
'  Startup so the proxy runs automatically after reboot.
'  To stop: open Task Manager and end the "node.exe" process.
' ============================================================
On Error Resume Next

Dim fso, shell, nodePath, scriptDir, repoUrl, startupLnk
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = scriptDir

repoUrl = "https://hyxxxf.github.io/xifan-workbench/proxy.js"

' ---------- 1. Locate Node.js ----------
nodePath = ""

Dim candidates(2)
candidates(0) = "C:\Users\nqszx\.workbuddy\binaries\node\versions\22.22.2\node.exe"
candidates(1) = "D:\Program Files\nodejs\node.exe"
candidates(2) = "C:\Program Files\nodejs\node.exe"

Dim i
For i = 0 To UBound(candidates)
    If fso.FileExists(candidates(i)) Then
        nodePath = candidates(i)
        Exit For
    End If
Next

If nodePath = "" Then
    Dim exec, line
    Set exec = shell.Exec("where node")
    Do While Not exec.StdOut.AtEndOfStream
        line = exec.StdOut.ReadLine
        If InStr(line, "node.exe") > 0 And nodePath = "" Then nodePath = Trim(line)
    Loop
End If

If nodePath = "" Then
    MsgBox "Node.js not found. Please install Node.js from https://nodejs.org or run WorkBuddy.", vbCritical, "Failed"
    WScript.Quit 1
End If

' ---------- 2. Download latest proxy.js ----------
Dim http, f, ok
ok = False
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "GET", repoUrl, False
http.Send
If http.Status = 200 Then
    Set f = fso.CreateTextFile(scriptDir & "\proxy.js", True)
    f.Write http.responseText
    f.Close
    ok = True
End If
On Error GoTo 0

If Not ok Then
    If fso.FileExists(scriptDir & "\proxy.js") Then
        ok = True
    Else
        MsgBox "Cannot download proxy.js (need access to hyxxxf.github.io) and no local copy found.", vbCritical, "Failed"
        WScript.Quit 1
    End If
End If

' ---------- 3. Run Node hidden (window style 0 = hidden) ----------
shell.Run """" & nodePath & """ """ & scriptDir & "\proxy.js""", 0, False

' ---------- 4. First run: add to Windows Startup ----------
On Error Resume Next
Dim startupDir, linkPath, link
startupDir = shell.SpecialFolders("Startup")
linkPath = startupDir & "\XifanLocalProxy.lnk"
If Not fso.FileExists(linkPath) Then
    Set link = shell.CreateShortcut(linkPath)
    link.TargetPath = WScript.ScriptFullName
    link.WorkingDirectory = scriptDir
    link.Description = "Xifan Workbench Local CORS Proxy"
    link.Save
End If
On Error GoTo 0

WScript.Quit 0
