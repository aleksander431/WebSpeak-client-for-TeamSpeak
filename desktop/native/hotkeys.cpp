// WebSpeak hotkey helper for keys Electron cannot register.
//
// Electron's globalShortcut has no name for Pause/Break and no mouse
// buttons. This helper registers such hotkeys with the Windows API and
// reports presses on stdout:
//
//   stdin:  set <id> <spec>    spec: [Ctrl+][Alt+][Shift+][Win+]Pause|Mouse4|Mouse5
//           hold <id> <key>    held keys (push-to-talk, whisper): one key, Ctrl/Alt/Shift, Mouse3/4/5
//           clear
//   stdout: ok <id> | taken <id> | invalid <id> | fire <id> | down <id> | up <id>
//
// Keys use RegisterHotKey (the key is taken from other programs, like
// Electron's own hotkeys). Mouse side buttons use a low-level mouse hook
// and are passed on to the focused program unchanged.
//
// A hold binding reports press and release through low-level hooks and
// never swallows the input, so a game still sees its key. Only the bound
// key is looked at; nothing else is recorded or reported.
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
HHOOK g_keyboardHook = nullptr;

// Held keys (push-to-talk, whisper), one per id, reported as down/up.
struct HoldBinding {
  int id = 0;
  UINT keys[2] = {0, 0};  // virtual keys (left/right variants for modifiers)
  int mouseButton = 0;    // 3 middle, 4 back, 5 forward
  bool held = false;
};
std::vector<HoldBinding> g_holds;
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

void SetHeld(HoldBinding& hold, bool held) {
  if (!hold.id || hold.held == held) return;
  hold.held = held;
  Emit(held ? "down" : "up", hold.id);
}

LRESULT CALLBACK KeyboardHook(int code, WPARAM wParam, LPARAM lParam) {
  if (code == HC_ACTION) {
    const KBDLLHOOKSTRUCT* info = reinterpret_cast<const KBDLLHOOKSTRUCT*>(lParam);
    for (HoldBinding& hold : g_holds) {
      if (hold.mouseButton) continue;
      if (info->vkCode == hold.keys[0] || (hold.keys[1] && info->vkCode == hold.keys[1])) {
        // Auto-repeat sends more key-downs while held; SetHeld ignores them.
        if (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN) SetHeld(hold, true);
        else if (wParam == WM_KEYUP || wParam == WM_SYSKEYUP) SetHeld(hold, false);
      }
    }
  }
  return CallNextHookEx(g_keyboardHook, code, wParam, lParam);
}

LRESULT CALLBACK MouseHook(int code, WPARAM wParam, LPARAM lParam) {
  if (code == HC_ACTION) {
    const MSLLHOOKSTRUCT* info = reinterpret_cast<const MSLLHOOKSTRUCT*>(lParam);
    const int xbutton = HIWORD(info->mouseData) == XBUTTON1 ? 4 : HIWORD(info->mouseData) == XBUTTON2 ? 5 : 0;
    for (HoldBinding& hold : g_holds) {
      if (!hold.mouseButton) continue;
      if (hold.mouseButton == 3 && wParam == WM_MBUTTONDOWN) SetHeld(hold, true);
      else if (hold.mouseButton == 3 && wParam == WM_MBUTTONUP) SetHeld(hold, false);
      else if (wParam == WM_XBUTTONDOWN && xbutton == hold.mouseButton) SetHeld(hold, true);
      else if (wParam == WM_XBUTTONUP && xbutton == hold.mouseButton) SetHeld(hold, false);
    }
  }
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
  for (const HoldBinding& hold : g_holds) needed = needed || hold.mouseButton != 0;
  for (const Binding& binding : g_bindings) needed = needed || binding.mouseButton != 0;
  if (needed && !g_mouseHook) g_mouseHook = SetWindowsHookExW(WH_MOUSE_LL, MouseHook, GetModuleHandleW(nullptr), 0);
  if (!needed && g_mouseHook) { UnhookWindowsHookEx(g_mouseHook); g_mouseHook = nullptr; }
}

void UpdateKeyboardHook() {
  bool needed = false;
  for (const HoldBinding& hold : g_holds) needed = needed || (hold.id && !hold.mouseButton);
  if (needed && !g_keyboardHook) g_keyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, KeyboardHook, GetModuleHandleW(nullptr), 0);
  if (!needed && g_keyboardHook) { UnhookWindowsHookEx(g_keyboardHook); g_keyboardHook = nullptr; }
}

void ClearBindings() {
  for (const Binding& binding : g_bindings) if (binding.registered) UnregisterHotKey(nullptr, binding.id);
  g_bindings.clear();
  for (HoldBinding& hold : g_holds) SetHeld(hold, false);
  g_holds.clear();
  UpdateMouseHook();
  UpdateKeyboardHook();
}

// Key names as Electron writes them (settings.ts), plus bare modifiers and mouse buttons.
bool ParseHoldKey(const std::string& name, HoldBinding* out) {
  struct Named { const char* name; UINT key; };
  static const Named kNamed[] = {
    {"Space", VK_SPACE}, {"Tab", VK_TAB}, {"Backspace", VK_BACK}, {"Delete", VK_DELETE}, {"Insert", VK_INSERT},
    {"Return", VK_RETURN}, {"Enter", VK_RETURN}, {"Up", VK_UP}, {"Down", VK_DOWN}, {"Left", VK_LEFT}, {"Right", VK_RIGHT},
    {"Home", VK_HOME}, {"End", VK_END}, {"PageUp", VK_PRIOR}, {"PageDown", VK_NEXT}, {"Escape", VK_ESCAPE}, {"Esc", VK_ESCAPE},
    {"numdec", VK_DECIMAL}, {"numadd", VK_ADD}, {"numsub", VK_SUBTRACT}, {"nummult", VK_MULTIPLY}, {"numdiv", VK_DIVIDE},
    {"`", VK_OEM_3}, {"-", VK_OEM_MINUS}, {"=", VK_OEM_PLUS}, {"[", VK_OEM_4}, {"]", VK_OEM_6}, {"\\", VK_OEM_5},
    {";", VK_OEM_1}, {"'", VK_OEM_7}, {",", VK_OEM_COMMA}, {".", VK_OEM_PERIOD}, {"/", VK_OEM_2},
    {"Capslock", VK_CAPITAL}, {"Numlock", VK_NUMLOCK}, {"Scrolllock", VK_SCROLL}, {"PrintScreen", VK_SNAPSHOT}, {"Pause", VK_PAUSE},
  };
  if (name == "Mouse3") { out->mouseButton = 3; return true; }
  if (name == "Mouse4") { out->mouseButton = 4; return true; }
  if (name == "Mouse5") { out->mouseButton = 5; return true; }
  // The low-level hook sees the left/right variant of a modifier.
  if (name == "Ctrl") { out->keys[0] = VK_LCONTROL; out->keys[1] = VK_RCONTROL; return true; }
  if (name == "Alt") { out->keys[0] = VK_LMENU; out->keys[1] = VK_RMENU; return true; }
  if (name == "Shift") { out->keys[0] = VK_LSHIFT; out->keys[1] = VK_RSHIFT; return true; }
  if (name.size() == 1 && ((name[0] >= 'A' && name[0] <= 'Z') || (name[0] >= '0' && name[0] <= '9'))) { out->keys[0] = static_cast<UINT>(name[0]); return true; }
  if (name.size() >= 2 && name.size() <= 3 && name[0] == 'F') {
    const int number = atoi(name.c_str() + 1);
    if (number >= 1 && number <= 24) { out->keys[0] = VK_F1 + number - 1; return true; }
  }
  if (name.size() == 4 && name.compare(0, 3, "num") == 0 && name[3] >= '0' && name[3] <= '9') { out->keys[0] = VK_NUMPAD0 + (name[3] - '0'); return true; }
  for (const Named& named : kNamed) if (name == named.name) { out->keys[0] = named.key; return true; }
  return false;
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
  if (sscanf(line, "hold %d %127s", &id, spec) == 2) {
    if (id <= 0 || id > 0xBFFF) return;
    // A new key for this id replaces its old one; other held keys stay.
    for (size_t index = 0; index < g_holds.size(); ++index) {
      if (g_holds[index].id != id) continue;
      SetHeld(g_holds[index], false);
      g_holds.erase(g_holds.begin() + index);
      break;
    }
    HoldBinding hold;
    hold.id = id;
    const auto drop = [id]() {
      for (size_t index = 0; index < g_holds.size(); ++index) if (g_holds[index].id == id) { g_holds.erase(g_holds.begin() + index); break; }
      UpdateMouseHook();
      UpdateKeyboardHook();
    };
    if (!ParseHoldKey(spec, &hold)) { UpdateMouseHook(); UpdateKeyboardHook(); Emit("invalid", id); return; }
    g_holds.push_back(hold);
    UpdateMouseHook();
    UpdateKeyboardHook();
    const bool hooked = hold.mouseButton ? g_mouseHook != nullptr : g_keyboardHook != nullptr;
    if (!hooked) { drop(); Emit("taken", id); return; }
    Emit("ok", id);
    return;
  }
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
