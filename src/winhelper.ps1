# Window helper for Claude Multi Launcher. Runs as a child of the launcher and exits when the launcher does.
#
# For each non-Default account it (1) gives the Claude window its own taskbar identity (own AppUserModelID so the
# taskbar keeps it as a separate button), a coloured icon with the account's initial, and a "[Name] " title prefix,
# and (2) on request, trims the working set of that account's processes so idle accounts give RAM back.
# It never touches the Default account: the launcher only sends it non-Default processes.
#
# Reads  : the state file   {"windows":[{pid,aumid,label,color,initial}], "trim":{nonce,pids:[..]}}
# Writes : one JSON object per line on stdout: {"fg":<pid>}, {"trimmed":{nonce,beforeMB,afterMB}}, {"styled":{pid,changes}}

$cs = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text;

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PROPERTYKEY { public Guid fmtid; public uint pid; }

[StructLayout(LayoutKind.Explicit, Size = 24)]
public struct PROPVARIANT {
  [FieldOffset(0)] public ushort vt;
  [FieldOffset(8)] public IntPtr p;
}

[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
  [PreserveSig] int GetCount(out uint c);
  [PreserveSig] int GetAt(uint i, out PROPERTYKEY k);
  [PreserveSig] int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
  [PreserveSig] int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
  [PreserveSig] int Commit();
}

public static class WinStyle {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, string l);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid riid, out IPropertyStore ps);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT pv);
  [DllImport("psapi.dll")] static extern bool EmptyWorkingSet(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int c, uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);

  const uint WM_SETTEXT = 0x000C, WM_SETICON = 0x0080, WM_GETICON = 0x007F, GW_OWNER = 4;
  const uint SWP_NOACTIVATE = 0x0010; // raise to top of z-order (hWndInsertAfter=0 means HWND_TOP) without stealing focus
  const int SW_RESTORE = 9;
  static PROPERTYKEY AumidKey = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
  static Guid IID_IPropertyStore = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
  static Dictionary<string, IntPtr[]> icons = new Dictionary<string, IntPtr[]>();

  static IntPtr MakeIcon(string color, string initial, int size) {
    Color c = ColorTranslator.FromHtml(color);
    double lum = (0.299 * c.R + 0.587 * c.G + 0.114 * c.B) / 255.0;
    Color fg = lum > 0.6 ? Color.FromArgb(26, 18, 6) : Color.White;
    using (Bitmap bmp = new Bitmap(size, size))
    using (Graphics g = Graphics.FromImage(bmp)) {
      g.SmoothingMode = SmoothingMode.AntiAlias;
      g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
      using (Brush b = new SolidBrush(c)) g.FillEllipse(b, 0, 0, size - 1, size - 1);
      using (Font f = new Font("Segoe UI", size * 0.55f, FontStyle.Bold, GraphicsUnit.Pixel))
      using (Brush tb = new SolidBrush(fg))
      using (StringFormat sf = new StringFormat()) {
        sf.Alignment = StringAlignment.Center; sf.LineAlignment = StringAlignment.Center;
        g.DrawString(initial, f, tb, new RectangleF(0, 0, size, size), sf);
      }
      return bmp.GetHicon();
    }
  }

  static IntPtr[] Icons(string color, string initial) {
    string key = color + "|" + initial;
    IntPtr[] pair;
    if (!icons.TryGetValue(key, out pair)) {
      pair = new IntPtr[] { MakeIcon(color, initial, 16), MakeIcon(color, initial, 48) };
      icons[key] = pair;
    }
    return pair;
  }

  static string ReadAumid(IPropertyStore ps) {
    PROPVARIANT v; PROPERTYKEY k = AumidKey;
    string s = null;
    if (ps.GetValue(ref k, out v) == 0 && v.vt == 31 && v.p != IntPtr.Zero) s = Marshal.PtrToStringUni(v.p);
    PropVariantClear(ref v);
    return s;
  }

  static void WriteAumid(IPropertyStore ps, string id) {
    PROPVARIANT v = new PROPVARIANT(); PROPERTYKEY k = AumidKey;
    v.vt = 31; v.p = Marshal.StringToCoTaskMemUni(id);
    ps.SetValue(ref k, ref v);
    ps.Commit();
    PropVariantClear(ref v);
  }

  public static List<string> Apply(uint pid, string aumid, string label, string color, string initial) {
    List<string> changes = new List<string>();
    string prefix = "[" + label + "] ";
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h) || GetWindow(h, GW_OWNER) != IntPtr.Zero) return true;
      StringBuilder cn = new StringBuilder(64); GetClassName(h, cn, 64);
      if (!cn.ToString().StartsWith("Chrome_WidgetWin")) return true;
      StringBuilder t = new StringBuilder(512); GetWindowText(h, t, 512);
      string title = t.ToString();
      if (title.Length == 0) return true;

      // Own taskbar identity so this account is a separate taskbar button.
      IPropertyStore ps;
      Guid iid = IID_IPropertyStore;
      if (SHGetPropertyStoreForWindow(h, ref iid, out ps) == 0 && ps != null) {
        try {
          if (ReadAumid(ps) != aumid) { WriteAumid(ps, aumid); changes.Add("aumid"); }
        } catch (Exception) { }
        Marshal.ReleaseComObject(ps);
      }

      // Coloured icon carrying the account's initial.
      IntPtr[] pair = Icons(color, initial);
      if (SendMessage(h, WM_GETICON, (IntPtr)1, IntPtr.Zero) != pair[1]) {
        SendMessage(h, WM_SETICON, (IntPtr)0, pair[0]);
        SendMessage(h, WM_SETICON, (IntPtr)1, pair[1]);
        changes.Add("icon");
      }

      // Title prefix, replacing an older prefix of ours if the account was renamed.
      if (!title.StartsWith(prefix)) {
        string bare = title;
        if (bare.StartsWith("[")) { int end = bare.IndexOf("] "); if (end > 0 && end < 45) bare = bare.Substring(end + 2); }
        SendMessage(h, WM_SETTEXT, IntPtr.Zero, prefix + bare);
        changes.Add("title");
      }
      return true;
    }, IntPtr.Zero);
    return changes;
  }

  // Read-only diagnostics: what does Windows currently hold for this process's top-level windows?
  public static List<string> Describe(uint pid) {
    List<string> rows = new List<string>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h) || GetWindow(h, GW_OWNER) != IntPtr.Zero) return true;
      StringBuilder cn = new StringBuilder(64); GetClassName(h, cn, 64);
      if (!cn.ToString().StartsWith("Chrome_WidgetWin")) return true;
      StringBuilder t = new StringBuilder(512); GetWindowText(h, t, 512);
      string aumid = "(none)";
      IPropertyStore ps; Guid iid = IID_IPropertyStore;
      if (SHGetPropertyStoreForWindow(h, ref iid, out ps) == 0 && ps != null) {
        string a = ReadAumid(ps); if (a != null) aumid = a;
        Marshal.ReleaseComObject(ps);
      }
      IntPtr big = SendMessage(h, WM_GETICON, (IntPtr)1, IntPtr.Zero);
      rows.Add("title=[" + t + "]  aumid=" + aumid + "  bigIcon=" + (big == IntPtr.Zero ? "none" : "set"));
      return true;
    }, IntPtr.Zero);
    return rows;
  }

  // Finds this pid's visible top-level Claude window and moves it to the given rectangle. Returns true if a window
  // was found and moved.
  public static bool MoveWindow(uint pid, int x, int y, int w, int h) {
    bool moved = false;
    EnumWindows(delegate (IntPtr hw, IntPtr l) {
      uint p; GetWindowThreadProcessId(hw, out p);
      if (p != pid || !IsWindowVisible(hw) || GetWindow(hw, GW_OWNER) != IntPtr.Zero) return true;
      StringBuilder cn = new StringBuilder(64); GetClassName(hw, cn, 64);
      if (!cn.ToString().StartsWith("Chrome_WidgetWin")) return true;
      StringBuilder t = new StringBuilder(512); GetWindowText(hw, t, 512);
      if (t.Length == 0) return true;
      if (IsIconic(hw)) ShowWindow(hw, SW_RESTORE);
      moved = SetWindowPos(hw, IntPtr.Zero, x, y, w, h, SWP_NOACTIVATE) || moved;
      return true;
    }, IntPtr.Zero);
    return moved;
  }

  public static uint ForegroundPid() {
    uint p = 0; GetWindowThreadProcessId(GetForegroundWindow(), out p); return p;
  }

  // Moves a process's idle pages out of its working set. Windows brings back what is used again.
  public static long[] Trim(uint[] pids) {
    long before = 0, after = 0;
    foreach (uint pid in pids) {
      try {
        Process pr = Process.GetProcessById((int)pid);
        before += pr.WorkingSet64;
        IntPtr h = OpenProcess(0x0100 | 0x0400, false, pid);
        if (h != IntPtr.Zero) { EmptyWorkingSet(h); CloseHandle(h); }
        pr.Refresh();
        after += pr.WorkingSet64;
      } catch (Exception) { }
    }
    return new long[] { before, after };
  }
}
'@

Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing

$stateFile = '__STATE__'
$parentPid = __PARENT__
$lastStamp = $null
$state = $null
$lastNonce = 0
$lastLayoutNonce = 0
$lastFg = 0

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}

while ($true) {
  if (-not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) { break }

  $stamp = (Get-Item -LiteralPath $stateFile -ErrorAction SilentlyContinue).LastWriteTimeUtc.Ticks
  if ($stamp -and $stamp -ne $lastStamp) {
    try { $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json; $lastStamp = $stamp } catch { }
  }

  if ($state) {
   try {
    foreach ($w in @($state.windows)) {
      if (-not $w.pid) { continue }
      $initial = ([string]$w.initial).Substring(0, 1)
      $changes = [WinStyle]::Apply([uint32]$w.pid, [string]$w.aumid, [string]$w.label, [string]$w.color, $initial)
      if ($changes.Count -gt 0) { Emit @{ styled = @{ pid = $w.pid; changes = @($changes) } } }
    }

    if ($state.trim -and $state.trim.nonce -and $state.trim.nonce -ne $lastNonce) {
      $lastNonce = $state.trim.nonce
      $r = [WinStyle]::Trim([uint32[]]@($state.trim.pids))
      Emit @{ trimmed = @{ nonce = $lastNonce; beforeMB = [math]::Round($r[0] / 1MB); afterMB = [math]::Round($r[1] / 1MB) } }
    }

    if ($state.layout -and $state.layout.nonce -and $state.layout.nonce -ne $lastLayoutNonce) {
      $lastLayoutNonce = $state.layout.nonce
      $moved = 0
      foreach ($w in @($state.layout.windows)) {
        if ([WinStyle]::MoveWindow([uint32]$w.pid, [int]$w.x, [int]$w.y, [int]$w.width, [int]$w.height)) { $moved++ }
      }
      Emit @{ tiled = @{ nonce = $lastLayoutNonce; moved = $moved } }
    }
   } catch {
    Emit @{ error = $_.Exception.ToString() }
   }
  }

  $fg = [WinStyle]::ForegroundPid()
  if ($fg -ne $lastFg) { $lastFg = $fg; Emit @{ fg = [int]$fg } }

  Start-Sleep -Milliseconds 700
}
