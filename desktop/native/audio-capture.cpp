// WebSpeak system-audio helper (Windows 10 2004+).
//
// Captures everything the PC plays EXCEPT the audio of one process tree
// (WebSpeak itself, so voices from the channel stay out of a screen share),
// using WASAPI process loopback. Writes 48 kHz stereo signed 16-bit PCM to
// stdout until stdout closes or the excluded process exits.
//
//   webspeak-audio-capture.exe <pid>          capture
//   webspeak-audio-capture.exe <pid> --probe  only check that it is supported
//
// Exit codes: 0 done, 2 bad arguments, 3 process loopback unsupported,
// 4 capture failed.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <fcntl.h>
#include <io.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#if defined(__has_include)
#if __has_include(<audioclientactivationparams.h>)
#include <audioclientactivationparams.h>
#define WEBSPEAK_HAVE_ACTIVATION_PARAMS 1
#endif
#endif

#ifndef WEBSPEAK_HAVE_ACTIVATION_PARAMS
// Declarations from the Windows SDK (10.0.20348+) for older toolchains.
typedef enum AUDIOCLIENT_ACTIVATION_TYPE {
  AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT = 0,
  AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1
} AUDIOCLIENT_ACTIVATION_TYPE;
typedef enum PROCESS_LOOPBACK_MODE {
  PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0,
  PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1
} PROCESS_LOOPBACK_MODE;
typedef struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
  DWORD TargetProcessId;
  PROCESS_LOOPBACK_MODE ProcessLoopbackMode;
} AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;
typedef struct AUDIOCLIENT_ACTIVATION_PARAMS {
  AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
  union {
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
  };
} AUDIOCLIENT_ACTIVATION_PARAMS;
#endif

#ifndef VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK
#define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"VAD\\Process_Loopback"
#endif

static const IID kIidAudioClient = {0x1CB9AD4C, 0xDBFA, 0x4c32, {0xB1, 0x78, 0xC2, 0xF5, 0x68, 0xA7, 0x03, 0xB2}};
static const IID kIidAudioCaptureClient = {0xC8ADBD64, 0xE71E, 0x48a0, {0xA4, 0xDE, 0x18, 0x5C, 0x39, 0x5C, 0xD3, 0x17}};
static const IID kIidCompletionHandler = {0x41D949AB, 0x9862, 0x444A, {0x80, 0xF6, 0xC2, 0x61, 0x33, 0x4D, 0xA5, 0xEB}};
static const IID kIidAgileObject = {0x94EA2B94, 0xE9CC, 0x49E0, {0xC0, 0xFF, 0xEE, 0x64, 0xCA, 0x8F, 0x5B, 0x90}};

// Completion handler for ActivateAudioInterfaceAsync. It must be agile
// (free-threaded): the system calls it on a worker thread.
class ActivationHandler : public IActivateAudioInterfaceCompletionHandler {
 public:
  ActivationHandler() : refs_(1), result_(E_FAIL), client_(nullptr) {
    done_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  }
  virtual ~ActivationHandler() {
    if (client_) client_->Release();
    if (done_) CloseHandle(done_);
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refs_); }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG left = InterlockedDecrement(&refs_);
    if (left == 0) delete this;
    return left;
  }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override {
    if (!out) return E_POINTER;
    if (IsEqualIID(iid, IID_IUnknown) || IsEqualIID(iid, kIidCompletionHandler) || IsEqualIID(iid, kIidAgileObject)) {
      *out = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
      AddRef();
      return S_OK;
    }
    *out = nullptr;
    return E_NOINTERFACE;
  }
  HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT activated = E_FAIL;
    IUnknown* unknown = nullptr;
    HRESULT hr = operation->GetActivateResult(&activated, &unknown);
    if (SUCCEEDED(hr)) hr = activated;
    if (SUCCEEDED(hr) && unknown) hr = unknown->QueryInterface(kIidAudioClient, reinterpret_cast<void**>(&client_));
    if (unknown) unknown->Release();
    result_ = hr;
    SetEvent(done_);
    return S_OK;
  }
  bool Wait(DWORD ms) const { return WaitForSingleObject(done_, ms) == WAIT_OBJECT_0; }
  HRESULT result() const { return result_; }
  IAudioClient* TakeClient() {
    IAudioClient* client = client_;
    client_ = nullptr;
    return client;
  }

 private:
  LONG refs_;
  HRESULT result_;
  IAudioClient* client_;
  HANDLE done_;
};

static int Fail(int code, const char* what, HRESULT hr) {
  fprintf(stderr, "webspeak-audio-capture: %s (0x%08lx)\n", what, static_cast<unsigned long>(hr));
  return code;
}

int wmain(int argc, wchar_t** argv) {
  if (argc < 2) return Fail(2, "usage: webspeak-audio-capture <pid> [--probe]", E_INVALIDARG);
  const DWORD pid = static_cast<DWORD>(wcstoul(argv[1], nullptr, 10));
  const bool probe = argc > 2 && wcscmp(argv[2], L"--probe") == 0;
  if (pid == 0) return Fail(2, "invalid process id", E_INVALIDARG);

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return Fail(4, "CoInitializeEx failed", hr);

  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
  PROPVARIANT activation = {};
  activation.vt = VT_BLOB;
  activation.blob.cbSize = sizeof(params);
  activation.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  ActivationHandler* handler = new ActivationHandler();
  IActivateAudioInterfaceAsyncOperation* operation = nullptr;
  hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, kIidAudioClient, &activation, handler, &operation);
  if (FAILED(hr)) { handler->Release(); return Fail(3, "process loopback is not available", hr); }
  if (!handler->Wait(10000)) { handler->Release(); return Fail(3, "activation timed out", E_FAIL); }
  if (operation) operation->Release();
  if (FAILED(handler->result())) { hr = handler->result(); handler->Release(); return Fail(3, "process loopback activation failed", hr); }
  IAudioClient* client = handler->TakeClient();
  handler->Release();
  if (!client) return Fail(3, "no audio client", E_FAIL);

  // Process loopback has no mix format of its own: ask for the format we want.
  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = 2;
  format.nSamplesPerSec = 48000;
  format.wBitsPerSample = 16;
  format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                          200000 /* 20 ms in 100 ns units */, 0, &format, nullptr);
  if (FAILED(hr)) { client->Release(); return Fail(4, "IAudioClient::Initialize failed", hr); }
  if (probe) {
    client->Release();
    fputs("ok\n", stdout);
    return 0;
  }

  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  IAudioCaptureClient* capture = nullptr;
  hr = client->SetEventHandle(ready);
  if (SUCCEEDED(hr)) hr = client->GetService(kIidAudioCaptureClient, reinterpret_cast<void**>(&capture));
  if (SUCCEEDED(hr)) hr = client->Start();
  if (FAILED(hr)) {
    if (capture) capture->Release();
    client->Release();
    return Fail(4, "starting capture failed", hr);
  }

  _setmode(_fileno(stdout), _O_BINARY);
  HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, pid);
  static BYTE silence[48000 * 4 / 10];  // 100 ms of zeros
  bool running = true;
  while (running) {
    WaitForSingleObject(ready, 200);
    if (parent && WaitForSingleObject(parent, 0) == WAIT_OBJECT_0) break;
    UINT32 packet = 0;
    while (running && SUCCEEDED(capture->GetNextPacketSize(&packet)) && packet > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) { running = false; break; }
      size_t bytes = static_cast<size_t>(frames) * format.nBlockAlign;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        // The buffer content is undefined when flagged silent: write zeros.
        while (running && bytes > 0) {
          const size_t chunk = bytes < sizeof(silence) ? bytes : sizeof(silence);
          if (fwrite(silence, 1, chunk, stdout) != chunk) running = false;
          bytes -= chunk;
        }
      } else if (fwrite(data, 1, bytes, stdout) != bytes) {
        running = false;
      }
      capture->ReleaseBuffer(frames);
    }
    if (fflush(stdout) != 0) running = false;
  }

  client->Stop();
  capture->Release();
  client->Release();
  if (parent) CloseHandle(parent);
  CloseHandle(ready);
  CoUninitialize();
  return 0;
}
