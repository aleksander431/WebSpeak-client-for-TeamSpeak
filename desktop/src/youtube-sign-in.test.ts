import assert from "node:assert/strict";
import test from "node:test";
import { isSignInUrl, isYouTubePlayerFrame, signInFinished, signInUserAgent, withoutClientHints, staysInSignIn, YOUTUBE_SIGN_IN_URL } from "./youtube-sign-in.js";

test("the player's sign-in button opens inside the app, other YouTube links do not", () => {
  assert.ok(isSignInUrl("https://accounts.google.com/ServiceLogin?service=youtube&continue=x"));
  assert.ok(isSignInUrl("https://www.youtube.com/signin?action_handle_signin=true"));
  assert.ok(isSignInUrl(YOUTUBE_SIGN_IN_URL));
  assert.ok(!isSignInUrl("https://www.youtube.com/watch?v=abc"));
  assert.ok(!isSignInUrl("https://support.google.com/youtube/answer/3037019"));
  assert.ok(!isSignInUrl("http://accounts.google.com/"));
  assert.ok(!isSignInUrl("https://accounts.google.com.evil.example/"));
});

test("the sign-in window moves through Google and YouTube and is done back on YouTube", () => {
  assert.ok(staysInSignIn("https://accounts.google.com/v3/signin/challenge/pwd"));
  assert.ok(staysInSignIn("https://myaccount.google.com/"));
  assert.ok(staysInSignIn("https://www.google.ru/"));
  assert.ok(!staysInSignIn("https://example.com/"));
  assert.ok(!staysInSignIn("https://google.com.example.org/"));
  assert.ok(signInFinished("https://www.youtube.com/"));
  assert.ok(!signInFinished("https://www.youtube.com/signin?x=1"));
  assert.ok(!signInFinished("https://accounts.google.com/"));
});

test("players to reload and the browser the window presents itself as", () => {
  assert.ok(isYouTubePlayerFrame("https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1"));
  assert.ok(!isYouTubePlayerFrame("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
  const agent = signInUserAgent("win32");
  assert.equal(agent, "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0");
  assert.doesNotMatch(agent, /Electron|WebSpeak|Chrome/);
  assert.deepEqual(withoutClientHints({ "Sec-CH-UA": "x", "sec-ch-ua-platform": "y", "User-Agent": agent, Cookie: "c" }), { "User-Agent": agent, Cookie: "c" });
});
