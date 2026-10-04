from pathlib import Path
import json
import os
import sys
import time
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding="utf-8")
BASE = os.environ.get("DEMO_URL", "http://127.0.0.1:4319")
EVIDENCE = Path(__file__).resolve().parent.parent / ".evidence"
EVIDENCE.mkdir(exist_ok=True)

def snapshot(page):
    return page.evaluate("async () => (await (await fetch('/api/state')).json()).session")

def wait_state(page, predicate, timeout=25000):
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        state = snapshot(page)
        if state and predicate(state):
            return state
        page.wait_for_timeout(150)
    raise AssertionError("Demo state did not reach the requested condition")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 960}, accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("button", name="开始一局", exact=True)).to_be_visible()
    page.screenshot(path=str(EVIDENCE / "welcome.png"), full_page=True)
    page.get_by_role("button", name="开始一局", exact=True).click()
    expect(page.locator("#reveal-word")).to_be_visible()
    page.locator("#reveal-word").click()
    own_word = page.locator(".word-card .word").inner_text()
    player = snapshot(page)
    assert "assignments" not in player
    assert "reveal" not in player
    assert "ballots" not in player
    assert player["ownPrivate"]["card"]["word"] == own_word
    page.locator("#context-button").click()
    expect(page.locator("#context-dialog")).to_be_visible()
    payload = json.loads(page.locator("#context-content").inner_text())
    assert payload["actorId"] == "you"
    assert "assignments" not in payload
    page.locator("#context-dialog").get_by_role("button", name="关闭", exact=True).click()
    expect(page.locator("#send-button")).to_have_text("提交本轮描述", timeout=12000)
    page.screenshot(path=str(EVIDENCE / "game-your-turn.png"), full_page=True)
    page.locator("#message-input").fill("我直接说：" + own_word)
    page.locator("#send-button").click()
    expect(page.locator("#toast")).to_contain_text("直接包含")
    assert snapshot(page)["currentActor"] == "you"
    page.locator("#message-input").fill("日常生活里挺常见，可以根据场合选择使用它。")
    page.locator("#send-button").click()
    expect(page.locator("#begin-vote-button")).to_be_visible(timeout=10000)
    page.locator("#message-input").fill("@阿岚 你能补充一点公开线索吗？")
    page.locator("#send-button").click()
    expect(page.locator('.chat-message[data-sender="a"][data-type="chat"]')).to_have_count(1, timeout=6000)
    page.locator("#message-input").fill("我怀疑小满是卧底。")
    page.locator("#send-button").click()
    assert snapshot(page)["progress"]["voted"] == 0
    page.locator("#begin-vote-button").click()
    expect(page.locator("#vote-submit")).to_be_visible()
    page.screenshot(path=str(EVIDENCE / "game-voting.png"), full_page=True)
    page.locator('input[name="vote"]').first.check()
    page.locator("#vote-submit").click()
    wait_state(page, lambda s: s.get("lastResult") is not None)
    page.screenshot(path=str(EVIDENCE / "game-result.png"), full_page=True)
    print("PASS: player card, scoped context, descriptions, direct @ reply, formal vote, settlement")

    page.locator('[data-kind="work"]').click()
    expect(page.locator("#goal-input")).to_be_visible()
    goal = "验收目标：一个可交接、可接续的群聊 Demo。"
    page.locator("#goal-input").fill(goal)
    page.locator("#start-button").click()
    expect(page.locator("#interrupt-button")).to_be_enabled()
    page.locator("#interrupt-button").click()
    expect(page.locator('.chat-message[data-type="recovery"]')).to_have_count(1, timeout=7000)
    page.locator("#pause-button").click()
    expect(page.locator("#pause-button")).to_have_text("继续")
    before = snapshot(page)
    page.wait_for_timeout(2400)
    after = snapshot(page)
    assert before["messages"] == after["messages"]
    assert before["artifacts"] == after["artifacts"]
    page.reload()
    page.wait_for_load_state("networkidle")
    expect(page.locator("#pause-button")).to_have_text("继续")
    assert snapshot(page)["id"] == before["id"]
    page.locator("#pause-button").click()
    wait_state(page, lambda s: s["kind"] == "work" and s["status"] == "completed", timeout=25000)
    try:
        expect(page.locator(".artifact-link")).to_have_count(3)
    except Exception:
        page.screenshot(path=str(EVIDENCE / "work-failure.png"), full_page=True)
        print("WORK FAILURE", snapshot(page)["status"], page.locator("#toast").inner_text(), page.locator("body").inner_text()[-2500:])
        raise
    page.screenshot(path=str(EVIDENCE / "work-handoffs.png"), full_page=True)
    with page.expect_download() as download_info:
        page.locator(".artifact-link").first.click()
    downloaded = EVIDENCE / "downloaded-artifact.md"
    download_info.value.save_as(str(downloaded))
    artifact = downloaded.read_text(encoding="utf-8-sig")
    assert goal in artifact and "本地规则模拟" in artifact
    print("PASS: goal, recovery, user pause, refresh restore, three published artifacts, download")

    host_context = browser.new_context(viewport={"width": 1280, "height": 900})
    host_page = host_context.new_page()
    host_page.goto(BASE)
    host_page.wait_for_load_state("networkidle")
    host_page.locator('input[name="role"][value="host"]').check()
    host_page.locator("#start-button").click()
    expect(host_page.locator("#private-section .assignment")).to_have_count(5)
    assert snapshot(host_page)["role"] == "host"
    assert len(snapshot(host_page)["assignments"]) == 5
    host_page.screenshot(path=str(EVIDENCE / "host-view.png"), full_page=True)
    print("PASS: separate non-player host permissions")

    mobile_context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, device_scale_factor=1)
    mobile = mobile_context.new_page()
    mobile.goto(BASE)
    mobile.wait_for_load_state("networkidle")
    mobile.locator("#start-button").click()
    expect(mobile.locator("#reveal-word")).to_be_attached()
    assert mobile.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Mobile horizontal overflow"
    mobile.screenshot(path=str(EVIDENCE / "mobile.png"), full_page=True)
    print("PASS: mobile layout without horizontal overflow")
    assert not errors, "Browser JS errors: " + repr(errors)
    (EVIDENCE / "browser-verification.json").write_text(json.dumps({"passed": True, "scenarios": ["player-game", "work-recovery", "host-permission", "mobile"], "jsErrors": errors}, ensure_ascii=False, indent=2), encoding="utf-8")
    host_context.close()
    mobile_context.close()
    context.close()
    browser.close()
