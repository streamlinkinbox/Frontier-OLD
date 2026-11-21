/*============================================================================================================================================
                                                    VALIDATETRANSPORTPRESENTATION.CJS
============================================================================================================================================*/
// 🧩 Interaction, missing-report and responsive-layout checks for the retained GI evidence viewer only.

'use strict';
const Assert = require('node:assert/strict');
const Crypto = require('node:crypto');
const FileSystem = require('node:fs');
const Path = require('node:path');
const {chromium: Chromium} = require('playwright-core');
const Root = Path.resolve(__dirname, '../../..');
const Exhibit = Path.join(Root, 'Exhibits/DistanceClipmap');
const BaseUrl = process.argv[2];

function Digest(Location) {
    return Crypto.createHash('sha256').update(FileSystem.readFileSync(Location)).digest('hex');
}
async function NativeImages(Page, Selectors) {
    await Page.waitForFunction(Names => Names.every(Name => {
        const Picture = document.getElementById(Name);
        return Picture.complete && Picture.naturalWidth === 480 && Picture.naturalHeight === 270;
    }), Selectors);
}
async function Execute() {
    Assert.ok(BaseUrl && process.env.CHROMIUM_EXECUTABLE, 'Supply viewer URL and CHROMIUM_EXECUTABLE');
    const Browser = await Chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']});
    const Failures = [], HttpFailures = [];
    try {
        const Context = await Browser.newContext({viewport: {width: 1440, height: 1050}, reducedMotion: 'reduce'});
        const Page = await Context.newPage();
        Page.on('pageerror', Error => Failures.push(Error.message));
        Page.on('requestfailed', Request => Failures.push(Request.url() + ': ' + Request.failure().errorText));
        Page.on('response', Response => { if (Response.status() >= 400) HttpFailures.push(Response.url()); });
        await Page.goto(BaseUrl, {waitUntil: 'networkidle'});
        await Page.waitForFunction(() => document.querySelector('#report-status').textContent.includes('retained native captures'));
        Assert.equal(await Page.locator('#metrics tr').count(), 3);
        Assert.equal(await Page.locator('#play').textContent(), 'Play');
        await NativeImages(Page, ['direct', 'cone', 'probe', 'reference', 'motion-cone', 'motion-probe']);
        for (const Source of ['Emissive', 'Point', 'Sun', 'Area', 'Combined', 'Off']) {
            await Page.selectOption('#source', Source);
            await NativeImages(Page, ['direct', 'cone', 'probe']);
            Assert.equal(await Page.locator('#cone').getAttribute('src'), 'Images/Gi' + Source + 'Cone.png');
            Assert.equal(await Page.locator('#probe').getAttribute('src'), 'Images/Gi' + Source + 'Probe.png');
            const Extended = ['Emissive', 'Combined'].includes(Source);
            Assert.equal(await Page.locator('#reference-box').isVisible(), Extended);
            Assert.equal(await Page.locator('#bounce').isDisabled(), !Extended);
        }
        await Page.selectOption('#source', 'Combined');
        for (const Bounce of ['2', '4', '1']) {
            await Page.selectOption('#bounce', Bounce);
            await NativeImages(Page, ['cone', 'probe', 'reference']);
            Assert.equal(await Page.locator('#cone').getAttribute('src'), 'Images/GiCombinedCone' + (Bounce === '1' ? '' : Bounce) + '.png');
            if (Bounce === '4') Assert.match(await Page.locator('#method-note').textContent(), /not matched-depth/);
        }
        for (const Source of ['Emissive', 'Combined']) {
            await Page.selectOption('#source', Source);
            await Page.check('#gpu');
            await NativeImages(Page, ['cone', 'probe']);
            Assert.equal(await Page.locator('#cone').getAttribute('src'), 'Images/Gi' + Source + 'GpuCone.png');
            Assert.equal(await Page.locator('#probe').getAttribute('src'), 'Images/Gi' + Source + 'GpuProbe.png');
            await Page.uncheck('#gpu');
        }
        for (let Pose = 0; Pose < 12; ++Pose) {
            await Page.locator('#pose').evaluate((Control, Index) => {
                Control.value = String(Index); Control.dispatchEvent(new Event('input', {bubbles: true}));
            }, Pose);
            await NativeImages(Page, ['motion-cone', 'motion-probe']);
            for (const Method of ['Cone', 'Probe']) Assert.equal(await Page.locator('#motion-' + Method.toLowerCase()).getAttribute('src'),
                'Images/GiMotion' + Method + 'Lit' + String(Pose).padStart(2, '0') + '.png');
        }
        await Page.click('#play');
        await Page.waitForFunction(() => document.querySelector('#pose').value !== '11', null, {timeout: 2000});
        await Page.click('#play');
        Assert.equal(await Page.locator('#play').textContent(), 'Play');
        const Links = await Page.locator('a[href]').evaluateAll(Controls => [...new Set(Controls.map(Control => Control.getAttribute('href')))]);
        for (const Link of Links) {
            if (Link.startsWith('#') || Link.includes(':')) continue;
            Assert.equal((await Page.request.get(new URL(Link, BaseUrl).href)).status(), 200, Link);
        }
        await Page.selectOption('#source', 'Combined');
        await Page.locator('#pose').evaluate(Control => { Control.value = '0'; Control.dispatchEvent(new Event('input', {bubbles: true})); });
        await NativeImages(Page, ['cone', 'probe', 'motion-cone', 'motion-probe']);
        await Page.evaluate(() => window.scrollTo(0, 0));
        await Page.screenshot({path: Path.join(Exhibit, 'Images/GiPresentation.png'), fullPage: true});
        await Page.setViewportSize({width: 390, height: 844});
        Assert.equal(await Page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await Page.evaluate(() => window.scrollTo(0, 0));
        await Page.screenshot({path: Path.join(Exhibit, 'Images/GiPresentationMobile.png'), fullPage: true});
        Assert.deepEqual(Failures, []);
        Assert.deepEqual(HttpFailures, []);
        const Negative = await Context.newPage();
        await Negative.route('**/Results/GiSummary.json', Route => Route.fulfill({status: 503, body: 'Missing retained report'}));
        await Negative.goto(BaseUrl, {waitUntil: 'networkidle'});
        await Negative.waitForFunction(() => document.querySelector('#report-status').textContent.includes('Measurements unavailable'));
        Assert.equal(await Negative.locator('#metrics tr').count(), 0);
        Assert.equal(await Negative.locator('#capture-count').textContent(), '—');
        await Negative.unroute('**/Results/GiSummary.json');
        const Rejected = JSON.parse(FileSystem.readFileSync(Path.join(Exhibit, 'Results/GiSummary.json'), 'utf8'));
        Rejected.passed = false;
        await Negative.route('**/Results/GiSummary.json', Route => Route.fulfill({status: 200,
            contentType: 'application/json', body: JSON.stringify(Rejected)}));
        await Negative.reload({waitUntil: 'networkidle'});
        await Negative.waitForFunction(() => document.querySelector('#report-status').textContent.includes('Measurements unavailable'));
        Assert.equal(await Negative.locator('#metrics tr').count(), 0);
        Assert.equal(await Negative.locator('#capture-count').textContent(), '—');
        const Report = {passed: true, browser: Browser.version(), html_sha256: Digest(Path.join(Exhibit, 'Gi.html')),
            test_sha256: Digest(__filename), source_selections: 6, secondary_site_selections: 3, gpu_source_selections: 2,
            actual_motion_pose_selections: 12, reduced_motion_no_autoplay: true, play_pause: true, missing_report_rejected: true,
            failed_inspection_report_rejected: true, full_page_screenshots: true,
            local_links_checked: Links.length, mobile_horizontal_overflow: false, javascript_or_request_failures: Failures,
            unexpected_http_failures: HttpFailures, scope: 'HTML evidence viewer only; screenshots are not native editor/GPU-rendered scene captures.'};
        FileSystem.writeFileSync(Path.join(Exhibit, 'Results/GiPresentation.json'), JSON.stringify(Report, null, 2) + '\n');
        console.log(JSON.stringify(Report));
        await Context.close();
    } finally { await Browser.close(); }
}
Execute().catch(Failure => {
    FileSystem.writeFileSync(Path.join(Exhibit, 'Results/GiPresentation.json'), JSON.stringify({passed: false, error: String(Failure)}, null, 2) + '\n');
    console.error(Failure); process.exitCode = 1;
});
