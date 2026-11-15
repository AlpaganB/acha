"""Exercise the built public ACHA app in a fresh Chromium or Edge session."""

import argparse
import re
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from playwright.sync_api import Error, expect, sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:4179')
    parser.add_argument('--channel', help='Use an installed browser channel, for example msedge')
    parser.add_argument('--screenshots', type=Path)
    parser.add_argument('--research', action='store_true', help='Check live upstream fetches through the local API')
    parser.add_argument('--test-api', help='Write a sample measurement and assessment to a disposable loopback API')
    args = parser.parse_args()
    base = args.url.rstrip('/')
    if args.test_api and any(urlparse(url).hostname not in ('localhost', '127.0.0.1', '::1') for url in (base, args.test_api)):
        parser.error('The connected write test requires both a loopback site and a disposable loopback API.')
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)

    def screenshot(page, name, *, full_page=False):
        if args.screenshots:
            page.evaluate('window.scrollTo(0, 0)')
            page.screenshot(path=args.screenshots / f'{name}.png', full_page=full_page, animations='disabled')

    with sync_playwright() as play:
        browser = play.chromium.launch(channel=args.channel)
        for width, height in [(1440, 960), (390, 844)]:
            context = browser.new_context(viewport={'width': width, 'height': height}, reduced_motion='reduce')
            page = context.new_page()
            errors, writes = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: writes.append(request.url)
                    if '/api/' in request.url and request.method not in ('GET', 'HEAD', 'OPTIONS') else None)
            page.goto(base)
            start = page.get_by_role('button', name='Try a 90-second training scenario')
            expect(start).to_be_visible()
            start.click()
            anatomy = page.get_by_role('region', name='Body systems', exact=True)
            slider = anatomy.get_by_role('slider', name='Jump to a checkpoint')
            picker = anatomy.get_by_role('combobox', name='Scenario', exact=True)
            play_button = anatomy.get_by_role('button', name='Play', exact=True)
            anatomy.get_by_role('button', name='Pause', exact=True).click()
            expect(slider).to_have_value('0')
            expect(page.get_by_role('button', name=re.compile('Heart rate 66 bpm'))).to_be_visible()
            anatomy.get_by_role('combobox', name='Playback', exact=True).select_option('2')
            play_button.click()
            expect(slider).to_have_value('1', timeout=5000)
            anatomy.get_by_role('button', name='Pause').click()
            anatomy.get_by_role('button', name='Next').click()
            expect(slider).to_have_value('2')
            expect(page.get_by_role('button', name=re.compile(r'Heart rate 83 bpm.*\+17 bpm'))).to_be_visible()
            expect(anatomy.get_by_text('Comparison provisional; activity/posture unavailable.', exact=False)).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth === innerWidth'), 'The page overflows horizontally'
            if width == 1440:
                assert slider.bounding_box()['y'] < height, 'Playback controls are below the desktop viewport'
                screenshot(page, 'command-center-desktop')
            else:
                screenshot(page, 'command-center-mobile', full_page=True)
            anatomy.get_by_role('button', name='Read why').click()
            expect(page.get_by_role('heading', name='Heart rate trend')).to_be_focused()
            expect(page.get_by_text('Why this event appears')).to_be_visible()
            page.keyboard.press('Escape')
            expect(page.get_by_text('Why this event appears')).to_have_count(0)
            page.get_by_role('button', name='Open fictional check-in').click()
            expect(page.get_by_text('Fictional assessment open. Repeat pending.')).to_be_visible()
            expect(page.get_by_role('button', name='Record 72 bpm repeat')).to_be_disabled()
            slider.press('ArrowRight')
            page.get_by_role('button', name='Record 72 bpm repeat').click()
            page.get_by_role('button', name='Link repeat to check-in').click()
            page.get_by_role('button', name='Close follow-up').click()
            expect(page.get_by_text('Follow-up closed. Workflow completion documented.')).to_be_visible()
            slider.press('Home')
            expect(anatomy.get_by_text('Heart rate above this crew member’s reference')).to_have_count(0)

            picker.select_option('orbital-pressure')
            expect(slider).to_have_value('0')
            for _ in range(3):
                slider.press('ArrowRight')
            expect(anatomy.get_by_text('Cabin pressure samples unavailable', exact=True)).to_be_visible()
            expect(page.get_by_text('160/170 min covered', exact=False)).to_be_visible()
            slider.press('End')
            expect(page.get_by_text('2 transitions · 340/360 min covered', exact=False)).to_be_visible()

            picker.select_option('solar-event')
            slider.press('ArrowRight')
            slider.press('ArrowRight')
            expect(page.get_by_role('button', name=re.compile(r'Cabin monitor dose rate 250 µGy\/h'))).to_be_visible()
            expect(page.get_by_role('button', name=re.compile('Crew dosimeter total 430 µGy'))).to_be_visible()
            expect(anatomy.get_by_text('Relay unavailable · Queued locally')).to_be_visible()
            slider.press('ArrowRight')
            slider.press('ArrowRight')
            expect(anatomy.get_by_text('Personal dosimeter sample unavailable', exact=True).first).to_be_visible()
            slider.press('ArrowRight')
            expect(anatomy.get_by_text('Relay available · Sent · awaiting receipt')).to_be_visible()
            slider.press('ArrowRight')
            expect(anatomy.get_by_text('Relay available · Acknowledged')).to_be_visible()
            anatomy.get_by_role('combobox', name='Playback', exact=True).select_option('8')
            play_button.click()
            page.get_by_role('link', name='Open full replay').click()
            expect(slider).to_have_value('6')
            expect(play_button).to_be_visible()
            if width == 1440:
                screenshot(page, 'solar-handover')
            page.get_by_role('link', name='Overview console').click()
            expect(slider).to_have_value('6')
            anatomy.get_by_role('button', name='Exit scenario').click()
            expect(start).to_be_visible()

            page.wait_for_function('navigator.serviceWorker.controller !== null', timeout=25_000)
            context.set_offline(True)
            page.goto(f'{base}/?scenario=lunar-fatigue&step=4')
            expect(slider).to_have_value('3')
            expect(page.get_by_text('Follow-up closed. Workflow completion documented.')).to_be_visible()
            page.goto(f'{base}/scenarios/orbital-pressure?step=4')
            expect(slider).to_have_value('3')
            page.goto(f'{base}/monitoring')
            expect(page.get_by_role('heading', name='Crew monitoring', exact=True)).to_be_visible()
            assert not writes, f'Replay sent writes to the mission API: {writes}'
            assert not errors, f'Browser exceptions: {errors}'
            context.close()
            print(f'{width}px: playback, event evidence, local persistence, keyboard, no writes and offline reload passed')

        with browser.new_context(service_workers='block') as stalled_connection:
            page = stalled_connection.new_page()
            pending_routes = []
            page.route('**/api/v1/**', lambda route: pending_routes.append(route))
            page.goto(base)
            expect(page.get_by_text('Service unavailable', exact=True)).to_be_visible(timeout=13_000)
            expect(page.get_by_role('button', name='Retry', exact=True)).to_be_visible()
            expect(page.get_by_role('button', name='Try a 90-second training scenario')).to_be_visible()
            for route in pending_routes:
                try:
                    route.abort()
                except Error:
                    # Chromium can discard an interception when the app aborts its fetch.
                    pass
            print('Stalled mission requests reached the connection timeout and left training available')

        if args.research:
            page = browser.new_page(viewport={'width': 1440, 'height': 960})
            page.goto(f'{base}/research')
            page.get_by_role('combobox', name='Archive window', exact=True).select_option('day')
            page.get_by_role('button', name='Fetch from NASA').click()
            expect(page.get_by_text('288 timestamps · NASA environmental research')).to_be_visible(timeout=20_000)
            screenshot(page, 'nasa-rr6-archive', full_page=True)
            page.goto(f'{base}/research?view=radiation')
            page.get_by_role('combobox', name='Archive window', exact=True).select_option('sample')
            expect(page.get_by_text('Browse 84 instrument observations')).to_be_visible(timeout=20_000)
            screenshot(page, 'nasa-dostel1-archive', full_page=True)
            print('Real NASA RR-6 and DosTel1 research fetches passed')
        if args.test_api:
            check_connected(browser, base, args.test_api.rstrip('/'))
        browser.close()


def check_connected(browser, base, api):
    """Use a fresh local database so the test never writes shared mission records."""
    with browser.new_context() as context:
        profile = context.request.post(f'{api}/api/v1/mission-profiles', data={
            'name': 'Browser acceptance station', 'environment': 'orbital_station',
        })
        assert profile.ok, profile.text()
        member = context.request.post(f'{api}/api/v1/crew-members', data={
            'display_name': f'Browser test {uuid4().hex[:8]}', 'mission_profile_id': profile.json()['id'],
        })
        assert member.ok, member.text()
        crew = member.json()
        page = context.new_page()
        page.route('**/api/v1/**', lambda route: route.fulfill(response=route.fetch(url=route.request.url.replace(base, api, 1))))
        page.goto(f'{base}/measurements?kind=heart_rate')
        page.get_by_role('link', name='Change crew member').click()
        page.get_by_role('button', name=re.compile(crew['display_name'])).click()
        page.get_by_role('link', name='Measurements', exact=True).click()
        form = page.get_by_role('region', name='Record a measurement')
        form.get_by_role('combobox', name='Indicator', exact=True).select_option('heart_rate')
        form.get_by_role('spinbutton', name='Reading (bpm)').fill('71')
        with page.expect_response(lambda response: response.request.method == 'POST' and response.url.endswith('/measurements')) as saved:
            page.get_by_role('button', name='Save measurement').click()
        assert saved.value.ok, saved.value.text()
        measurement = saved.value.json()
        expect(page.get_by_text('Measurement saved to the mission service.')).to_be_visible()
        page.get_by_role('button', name='Assess saved measurement').click()
        expect(page.get_by_role('checkbox', name=re.compile(r'Heart rate.*71 bpm'))).to_be_checked()
        with page.expect_response(lambda response: response.request.method == 'POST' and urlparse(response.url).path.endswith('/assessments')) as submitted:
            page.get_by_role('button', name='Submit assessment').click()
        assert submitted.value.ok, submitted.value.text()
        assert submitted.value.json()['measurement_ids'] == [measurement['id']]
        assert submitted.value.json()['engine_result'] is not None
        expect(page.get_by_role('heading', name='Assessment result', exact=False)).to_be_visible()
        persisted = context.request.get(f"{api}/api/v1/crew-members/{crew['id']}/assessments")
        assert persisted.ok and persisted.json()[0]['id'] == submitted.value.json()['id']
        page.unroute_all(behavior='wait')
        print('Connected browser saved a measurement and a linked assessment to isolated PostgreSQL')


if __name__ == '__main__':
    main()
