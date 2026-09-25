# Link watcher for Claude Multi Launcher. Runs as a child of the launcher and exits when the launcher does.
#
# When a browser hands a claude:// link to Windows, Windows starts a short-lived Claude.exe with that link on its command
# line. The process can be gone within a few hundred milliseconds, so this checks the process list every 20 ms using
# EnumProcesses (cheap) and only looks inside processes that are new. Processes that already existed when the watcher
# started are ignored. It reads command lines only; it never changes or stops any process.
#
# Writes one JSON object per line on stdout: {"pid":123,"cmd":"..."}

$cs = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class ProcWatch {
  [DllImport("psapi.dll")] static extern bool EnumProcesses([Out] uint[] pids, uint cb, out uint bytes);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr h, uint flags, StringBuilder name, ref uint size);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int cls, IntPtr pbi, int size, out int ret);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);

  public static bool Debug = false;
  public static List<string> Log = new List<string>();
  static void D(string m) { if (Debug) Log.Add(m); }
  static HashSet<uint> known = new HashSet<uint>();
  static Dictionary<uint, int> tries = new Dictionary<uint, int>();
  static bool primed = false;

  static bool IsClaude(uint pid) {
    IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
    if (h == IntPtr.Zero) { D("pid " + pid + ": cannot open process, error " + Marshal.GetLastWin32Error()); return false; }
    try {
      StringBuilder sb = new StringBuilder(1024); uint size = 1024;
      if (!QueryFullProcessImageNameW(h, 0, sb, ref size)) { D("pid " + pid + ": no image name"); return false; }
      bool ok = string.Equals(Path.GetFileName(sb.ToString()), "claude.exe", StringComparison.OrdinalIgnoreCase);
      D("pid " + pid + ": " + Path.GetFileName(sb.ToString()) + (ok ? " (claude)" : ""));
      return ok;
    } finally { CloseHandle(h); }
  }

  // The command line lives in the target's PEB, which is the same place WMI reads it from.
  static string CommandLine(uint pid) {
    IntPtr h = OpenProcess(0x0410, false, pid); // QUERY_INFORMATION | VM_READ
    if (h == IntPtr.Zero) return null;
    IntPtr pbi = Marshal.AllocHGlobal(48);
    try {
      int ret;
      if (NtQueryInformationProcess(h, 0, pbi, 48, out ret) != 0) return null;
      IntPtr peb = Marshal.ReadIntPtr(pbi, 8);
      byte[] p8 = new byte[8]; IntPtr rd;
      if (!ReadProcessMemory(h, new IntPtr(peb.ToInt64() + 0x20), p8, (IntPtr)8, out rd)) return null;
      IntPtr parms = new IntPtr(BitConverter.ToInt64(p8, 0));
      if (parms == IntPtr.Zero) return null;
      byte[] us = new byte[16];
      if (!ReadProcessMemory(h, new IntPtr(parms.ToInt64() + 0x70), us, (IntPtr)16, out rd)) return null;
      int len = BitConverter.ToUInt16(us, 0);
      IntPtr buf = new IntPtr(BitConverter.ToInt64(us, 8));
      if (len == 0 || buf == IntPtr.Zero) return null;
      byte[] text = new byte[len];
      if (!ReadProcessMemory(h, buf, text, (IntPtr)len, out rd)) return null;
      return Encoding.Unicode.GetString(text);
    } finally { Marshal.FreeHGlobal(pbi); CloseHandle(h); }
  }

  // Returns [pid, commandLine] for each new Claude.exe whose command line carries a claude: link.
  public static List<string[]> Poll() {
    List<string[]> hits = new List<string[]>();
    uint[] pids = new uint[4096]; uint bytes;
    if (!EnumProcesses(pids, (uint)(pids.Length * 4), out bytes)) return hits;
    int n = (int)(bytes / 4);
    HashSet<uint> now = new HashSet<uint>();
    for (int i = 0; i < n; i++) {
      uint pid = pids[i];
      if (pid == 0) continue;
      now.Add(pid);
      if (known.Contains(pid)) continue;
      if (!primed) { known.Add(pid); continue; }   // first pass: everything already running is ignored
      try {
        if (!IsClaude(pid)) { known.Add(pid); continue; }
        string cmd = CommandLine(pid);
        D("pid " + pid + ": command line " + (cmd == null ? "not readable yet" : cmd.Substring(0, Math.Min(80, cmd.Length))));
        int t; tries.TryGetValue(pid, out t);
        if (cmd == null) {
          // Too early in the process's life for its parameters to exist yet: try again on the next pass.
          tries[pid] = t + 1;
          if (t > 40) known.Add(pid);
          continue;
        }
        known.Add(pid);
        if (cmd.IndexOf("claude:", StringComparison.OrdinalIgnoreCase) >= 0) hits.Add(new string[] { pid.ToString(), cmd });
      } catch (Exception) { known.Add(pid); }
    }
    known.IntersectWith(now);
    List<uint> stale = new List<uint>();
    foreach (uint k in tries.Keys) if (!now.Contains(k)) stale.Add(k);
    foreach (uint k in stale) tries.Remove(k);
    primed = true;
    return hits;
  }
}
'@

Add-Type -TypeDefinition $cs

$parentPid = __PARENT__
if ($env:CML_WATCH_DEBUG -eq '1') { [ProcWatch]::Debug = $true }
[void][ProcWatch]::Poll()   # prime: remember what is already running
$tick = 0

while ($true) {
  foreach ($hit in [ProcWatch]::Poll()) {
    [Console]::Out.WriteLine(([pscustomobject]@{ pid = [int]$hit[0]; cmd = $hit[1] } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
  }
  foreach ($l in [ProcWatch]::Log) {
    [Console]::Out.WriteLine(([pscustomobject]@{ debug = $l } | ConvertTo-Json -Compress))
  }
  [ProcWatch]::Log.Clear()
  [Console]::Out.Flush()
  $tick++
  if ($tick % 50 -eq 0 -and -not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 20
}
