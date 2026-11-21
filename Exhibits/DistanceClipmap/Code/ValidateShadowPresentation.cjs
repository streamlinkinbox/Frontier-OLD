/*============================================================================================================================================
                                                      VALIDATESHADOWPRESENTATION.CJS
============================================================================================================================================*/
// 🧩 Exercise all six native-image views, actual vehicle poses, mobile layout and rejected-report presentation in a real browser.

'use strict';
const Fs = require('node:fs');
const Crypto = require('node:crypto');
const Path = require('node:path');
const { chromium: Chromium } = require('playwright-core');

//------------------------------------------------------------------------------------------------------------------------
//                                                       PRESENTATION VALIDATION
//------------------------------------------------------------------------------------------------------------------------

function Enforce(Condition, Description)
{
    if (!Condition) throw new Error(Description);
}

function Digest(Location)
{
    return Crypto.createHash('sha256').update(Fs.readFileSync(Location)).digest('hex');
}

async function Execute()
{
    const Address = process.argv[2] || 'http://127.0.0.1:4175';
    const Exhibit = Path.resolve(__dirname, '..');
    const Browser = await Chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
    const Errors = [];
    try
    {
        const Page = await Browser.newPage({ viewport: { width: 1536, height: 1000 }, deviceScaleFactor: 1 });
        Page.on('pageerror', Failure => Errors.push(String(Failure)));
        await Page.goto(Address, { waitUntil: 'networkidle' });
        await Page.locator('#Status').filter({ hasText: 'integrity verified' }).waitFor();
        async function LoadedImages()
        {
            await Page.waitForFunction(() => [...document.querySelectorAll('#Grid img')].every(Picture => Picture.complete && Picture.naturalWidth === 480 && Picture.naturalHeight === 270));
        }
        const Views = ['Combined', 'Direct', 'Indirect', 'Visibility', 'Off'];
        for (const View of Views)
        {
            await Page.locator('[data-view="' + View + '"]').click();
            await LoadedImages();
            Enforce(await Page.locator('[data-view="' + View + '"]').getAttribute('aria-pressed') === 'true', 'Lighting selector did not change');
            for (let Mode = 0; Mode < 6; Mode++)
                Enforce((await Page.locator('#Grid img').nth(Mode).getAttribute('src')).endsWith('Shadow' + Mode + View + '.png'), 'Native image selector substituted another algorithm');
        }
        await Page.locator('[data-view="Combined"]').click();
        await LoadedImages();
        await Page.screenshot({ path: Path.join(Exhibit, 'Images/ShadowBrowserDesktop.png'), fullPage: false });
        for (let Pose = 0; Pose < 6; Pose++)
        {
            await Page.locator('#Pose').selectOption(String(Pose));
            await Page.waitForFunction(Pose => { const Picture = document.getElementById('Vehicle'); return Picture.complete && Picture.naturalWidth === 480 && Picture.getAttribute('src').endsWith('ShadowVehicle' + Pose + 'Combined.png'); }, Pose);
        }
        await Page.locator('#Animate').click();
        await Page.waitForTimeout(650);
        Enforce(await Page.locator('#Animate').getAttribute('aria-pressed') === 'true', 'Captured motion did not start');
        await Page.emulateMedia({ reducedMotion: 'reduce' });
        await Page.waitForFunction(() => document.getElementById('Animate').getAttribute('aria-pressed') === 'false');
        await Page.setViewportSize({ width: 390, height: 844 });
        await Page.evaluate(() => window.scrollTo(0, 0));
        Enforce(await Page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout overflows');
        await Page.screenshot({ path: Path.join(Exhibit, 'Images/ShadowBrowserMobile.png'), fullPage: false });
        const Links = await Page.locator('a[href]').evaluateAll(Anchors => [...new Set(Anchors.map(Anchor => Anchor.getAttribute('href')))]);
        for (const Link of Links)
        {
            if (Link.startsWith('#') || Link.includes('://')) continue;
            Enforce((await Page.request.get(new URL(Link, Address).href)).ok(), 'Broken evidence link: ' + Link);
        }
        const Rejected = await Browser.newPage();
        await Rejected.route('**/Results/ShadowIntegrity.json', Route => Route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ passed: false, renderer_accepted: false }) }));
        await Rejected.goto(Address, { waitUntil: 'networkidle' });
        await Rejected.locator('#Status[role="alert"]').waitFor();
        Enforce(!(await Rejected.locator('#Status').textContent()).includes('integrity verified'), 'HTTP-200 failed report displayed success');
        const Missing = await Browser.newPage();
        await Missing.route('**/Results/ShadowIntegrity.json', Route => Route.fulfill({ status: 404, body: 'missing' }));
        await Missing.goto(Address, { waitUntil: 'networkidle' });
        await Missing.locator('#Status[role="alert"]').waitFor();
        Enforce(Errors.length === 0, 'Unexpected browser script failures: ' + Errors.join('; '));
        const Report = { passed: true, browser: Browser.version(), native_views: 5, native_algorithms_each: 6,
            html_sha256: Digest(Path.join(Exhibit, 'Shadows.html')), test_sha256: Digest(__filename),
            summary_sha256: Digest(Path.join(Exhibit, 'Results/ShadowSummary.json')),
            integrity_sha256: Digest(Path.join(Exhibit, 'Results/ShadowIntegrity.json')),
            desktop_screenshot_sha256: Digest(Path.join(Exhibit, 'Images/ShadowBrowserDesktop.png')),
            mobile_screenshot_sha256: Digest(Path.join(Exhibit, 'Images/ShadowBrowserMobile.png')),
            vehicle_poses: 6, captured_playback: true, reduced_motion_stops: true, mobile_extent: [390, 844],
            no_horizontal_overflow: true, verified_links: Links.length, missing_report_rejected: true,
            http200_failed_report_rejected: true, unexpected_page_errors: Errors, renderer_accepted: false };
        Fs.writeFileSync(Path.join(Exhibit, 'Results/ShadowPresentation.json'), JSON.stringify(Report, null, 2) + '\n');
        console.log(JSON.stringify(Report));
    }
    finally
    {
        await Browser.close();
    }
}

Execute().catch(Failure => {
    Fs.writeFileSync(Path.resolve(__dirname, '../Results/ShadowPresentation.json'),
        JSON.stringify({ passed: false, failure: String(Failure), renderer_accepted: false }, null, 2) + '\n');
    console.error(Failure);
    process.exitCode = 1;
});
