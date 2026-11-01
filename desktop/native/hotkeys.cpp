// WebSpeak hotkey helper for keys Electron cannot register.
//
// Electron's globalShortcut has no name for Pause/Break and no mouse
// buttons. This helper registers such hotkeys with the Windows API and
// reports presses on stdout:
//
//   stdin:  set <id> <spec>    spec: [Ctrl+][Alt+][Shift+][Win+]Pause|Mouse4|Mouse5
//           clear
//   stdout: ok <id> | taken <id> | invalid <id> | fire <id>
//
// Keys use RegisterHotKey (the key is taken from other programs, like
// Electron's own hotkeys). Mouse side buttons use a low-level mouse hook
// and are passed on to the focused program unchanged.
// The helper exits when stdin closes or the parent process ends.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <string>
#include <vector>

namespace {

const UINT kCommandMessage = WM_APP + 1;
const UINT kQuitMessage = WM_APP + 2;
DWORD g_mainThread = 0;

struct Binding {
  int id;
  UINT modifiers;    // MOD_* flags
  UINT key;          // virtual key for keyboard hotkeys, 0 for mouse
  int mouseButton;   // 4 or 5 for mouse side buttons, 0 for keys
  bool registered;
};

std::vector<Binding> g_bindings;
HHOOK g_mouseHook = nullptr;
CRITICAL_SECTION g_outputLock;

void Emit(const char* kind, int id) {
  EnterCriticalSection(&g_outputLock);
  printf("%s %d\n", kind, id);
  fflush(stdout);
  LeaveCriticalSection(&g_outputLock);
}

UINT CurrentModifiers() {
  UINT flags = 0;
  if (GetAsyncKeyState(VK_CONTROL) & 0x8000) flags |= MOD_CONTROL;
  if (GetAsyncKeyState(VK_MENU) & 0x8000) flags |= MOD_ALT;
  if (GetAsyncKeyState(VK_SHIFT) & 0x8000) flags |= MOD_SHIFT;
  if ((GetAsyncKeyState(VK_LWIN) | GetAsyncKeyState(VK_RWIN)) & 0x8000) flags |= MOD_WIN;
  return flags;
}

LRESULT CALLBACK MouseHook(int code, WPARAM wParam, LPARAM lParam) {
  if (code == HC_ACTION && wParam == WM_XBUTTONDOWN) {
    const MSLLHOOKSTRUCT* info = reinterpret_cast<const MSLLHOOKSTRUCT*>(lParam);
    const int button = HIWORD(info->mouseData) == XBUTTON1 ? 4 : HIWORD(info->mouseData) == XBUTTON2 ? 5 : 0;
    if (button) {
      const UINT modifiers = CurrentModifiers();
      for (const Binding& binding : g_bindings) {
        if (binding.mouseButton == button && binding.modifiers == modifiers) Emit("fire", binding.id);
      }
    }
  }
  return CallNextHookEx(g_mouseHook, code, wParam, lParam);
}

void UpdateMouseHook() {
  bool needed = false;
  for (const Binding& binding : g_bindings) needed = needed || binding.mouseButton != 0;
  if (needed && !g_mouseHook) g_mouseHook = SetWindowsHookExW(WH_MOUSE_LL, MouseHook, GetModuleHandleW(nullptr), 0);
  if (!needed && g_mouseHook) { UnhookWindowsHookEx(g_mouseHook); g_mouseHook = nullptr; }
}

void ClearBindings() {
  for (const Binding& binding : g_bindings) if (binding.registered) UnregisterHotKey(nullptr, binding.id);
  g_bindings.clear();
  UpdateMouseHook();
}

// Parse "[Ctrl+][Alt+][Shift+][Win+]Key".
bool ParseSpec(const std::string& spec, Binding* out) {
  out->modifiers = 0;
  out->key = 0;
  out->mouseButton = 0;
  size_t start = 0;
  while (true) {
    const size_t plus = spec.find('+', start);
    const std::string part = spec.substr(start, plus == std::string::npos ? std::string::npos : plus - start);
    if (part.empty()) return false;
    if (plus == std::string::npos) {
      if (part == "Pause") out->key = VK_PAUSE;
      else if (part == "Mouse4") out->mouseButton = 4;
      else if (part == "Mouse5") out->mouseButton = 5;
      else return false;
      return true;
    }
    if (part == "Ctrl" || part == "CommandOrControl" || part == "Control") out->modifiers |= MOD_CONTROL;
    else if (part == "Alt") out->modifiers |= MOD_ALT;
    else if (part == "Shift") out->modifiers |= MOD_SHIFT;
    else if (part == "Win" || part == "Super") out->modifiers |= MOD_WIN;
    else return false;
    start = plus + 1;
  }
}

void HandleCommand(char* line) {
  char* end = line + strlen(line);
  while (end > line && (end[-1] == '\n' || end[-1] == '\r' || end[-1] == ' ')) *--end = '\0';
  if (strcmp(line, "clear") == 0) { ClearBindings(); return; }
  int id = 0;
  char spec[128] = {0};
  if (sscanf(line, "set %d %127s", &id, spec) != 2 || id <= 0 || id > 0xBFFF) return;
  Binding binding = {id, 0, 0, 0, false};
  if (!ParseSpec(spec, &binding)) { Emit("invalid", id); return; }
  if (binding.key) {
    binding.registered = RegisterHotKey(nullptr, id, binding.modifiers | MOD_NOREPEAT, binding.key) != 0;
    if (!binding.registered) { Emit("taken", id); return; }
  }
  g_bindings.push_back(binding);
  UpdateMouseHook();
  if (binding.mouseButton && !g_mouseHook) { Emit("taken", id); return; }
  Emit("ok", id);
}

// Reads stdin on its own thread and hands lines to the message loop, which
// owns the hotkeys and the hook (both are bound to the registering thread).
DWORD WINAPI ReadInput(LPVOID) {
  char buffer[256];
  while (fgets(buffer, sizeof(buffer), stdin)) {
    char* copy = _strdup(buffer);
    if (!copy || !PostThreadMessageW(g_mainThread, kCommandMessage, 0, reinterpret_cast<LPARAM>(copy))) free(copy);
  }
  PostThreadMessageW(g_mainThread, kQuitMessage, 0, 0);
  return 0;
}

DWORD WINAPI WatchParent(LPVOID parameter) {
  HANDLE parent = static_cast<HANDLE>(parameter);
  WaitForSingleObject(parent, INFINITE);
  PostThreadMessageW(g_mainThread, kQuitMessage, 0, 0);
  return 0;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  if (argc < 2) { fputs("usage: webspeak-hotkeys <parent-pid>\n", stderr); return 2; }
  const DWORD parentPid = static_cast<DWORD>(wcstoul(argv[1], nullptr, 10));
  if (parentPid == 0) { fputs("invalid process id\n", stderr); return 2; }
  InitializeCriticalSection(&g_outputLock);
  g_mainThread = GetCurrentThreadId();
  MSG message;
  // Create this thread's message queue before other threads post to it.
  PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, parentPid);
  if (parent) CloseHandle(CreateThread(nullptr, 0, WatchParent, parent, 0, nullptr));
  CloseHandle(CreateThread(nullptr, 0, ReadInput, nullptr, 0, nullptr));
  Emit("ready", 0);
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    if (message.message == WM_HOTKEY) Emit("fire", static_cast<int>(message.wParam));
    else if (message.message == kCommandMessage) {
      char* line = reinterpret_cast<char*>(message.lParam);
      HandleCommand(line);
      free(line);
    } else if (message.message == kQuitMessage) break;
  }
  ClearBindings();
  return 0;
}
