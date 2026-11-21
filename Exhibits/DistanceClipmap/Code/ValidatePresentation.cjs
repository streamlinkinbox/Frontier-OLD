/*============================================================================================================================================
                                                         VALIDATEPRESENTATION.CJS
============================================================================================================================================*/
// 🧩 Browser interaction checks for the retained evidence viewer, not the production renderer or editor.

'use strict';

const Assert = require('node:assert/strict');
const Crypto = require('node:crypto');
const FileSystem = require('node:fs');
const Path = require('node:path');
const {chromium: Chromium} = require('playwright-core');

const Root = Path.resolve(__dirname, '../../..');
const Exhibit = Path.join(Root, 'Exhibits/DistanceClipmap');
const ReportPath = Path.join(Exhibit, 'Results/Presentation.json');
const BaseUrl = process.argv[2];
const Executable = process.env.CHROMIUM_EXECUTABLE;

function Digest(FilePath)
{
    return Crypto.createHash('sha256').update(FileSystem.readFileSync(FilePath)).digest('hex');
}

async function RequireNativeImages(Page, Selectors)
{
    await Page.waitForFunction(Selection => Selection.every(Selector =>
    {
        const Picture = document.querySelector(Selector);
        return Picture.complete && Picture.naturalWidth === 480 && Picture.naturalHeight === 270;
    }), Selectors);
}

async function Execute()
{
    Assert.ok(BaseUrl && Executable, 'Supply the viewer URL and CHROMIUM_EXECUTABLE');
    FileSystem.rmSync(ReportPath, {force: true});
    const Failures = [];
    const Responses = [];
    const Browser = await Chromium.launch({
        executablePath: Executable,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    try
    {
        const Context = await Browser.newContext({
            viewport: {width: 1440, height: 1050},
            reducedMotion: 'reduce',
            locale: 'en-GB'
        });
        const Page = await Context.newPage();
        Page.on('pageerror', Failure => Failures.push(Failure.message));
        Page.on('requestfailed', Request => Failures.push(Request.url() + ': ' + Request.failure().errorText));
        Page.on('response', Response =>
        {
            if (Response.status() >= 400) Responses.push({url: Response.url(), status: Response.status()});
        });
        await Page.goto(BaseUrl, {waitUntil: 'networkidle'});
        await Page.waitForFunction(() => document.querySelector('#load-status').textContent.includes('82 retained'));
        Assert.match(await Page.locator('#top-benchmark').textContent(), /3\.56% slower/);
        Assert.match(await Page.locator('#benchmark-status').textContent(), /speed gate FAILS/);
        Assert.match(await Page.locator('#cache-quality-summary').textContent(), /slightly worse/);
        Assert.equal(await Page.locator('#ray-count').textContent(), '8,192');
        Assert.equal(await Page.locator('#device-rays').textContent(), '16,396');
        Assert.equal(await Page.locator('#nan-count').textContent(), '0');
        Assert.equal(await Page.locator('#measurement-rows tr').count(), 11);
        Assert.equal(await Page.locator('#motion-play').textContent(), 'Play');
        await RequireNativeImages(Page, ['#shadow-above', '#source-direct', '#motion-lit']);

        const ShadowSelections = ['LocalVoxelPenumbra', 'ClipmapPenumbra', 'HybridDirect'];
        for (const Selection of ShadowSelections)
        {
            await Page.selectOption('#shadow-choice', Selection);
            await RequireNativeImages(Page, ['#shadow-above']);
            Assert.ok((await Page.locator('#shadow-above').getAttribute('src')).endsWith(Selection + '.png'));
        }
        await Page.locator('#shadow-split').evaluate(Control =>
        {
            Control.value = '73';
            Control.dispatchEvent(new Event('input', {bubbles: true}));
        });
        Assert.equal(await Page.locator('#shadow-divider').evaluate(Control => Control.style.left), '73%');
        Assert.match(await Page.locator('#shadow-above').evaluate(Control => Control.style.clipPath), /27%/);

        const SourceSelections = ['Emissive', 'Point', 'Sun', 'Area', 'Combined'];
        for (const Selection of SourceSelections)
        {
            await Page.selectOption('#source-choice', Selection);
            await RequireNativeImages(Page, ['#source-direct', '#source-reference', '#source-cached', '#source-cache']);
            const Budget = ['Emissive', 'Combined'].includes(Selection) ? '512' : '';
            Assert.equal(await Page.locator('#source-direct').getAttribute('src'), 'Images/' + Selection + 'OnlyDirect.png');
            Assert.equal(await Page.locator('#source-reference').getAttribute('src'), 'Images/' + Selection + 'ReferenceGi' + Budget + '.png');
            Assert.equal(await Page.locator('#source-cached').getAttribute('src'), 'Images/' + Selection + 'CachedGi' + Budget + '.png');
            Assert.equal(await Page.locator('#source-cache').getAttribute('src'), 'Images/' + Selection + 'SurfaceCache.png');
        }

        for (let Index = 0; Index < 12; ++Index)
        {
            await Page.locator('#motion-scrub').evaluate((Control, Coordinate) =>
            {
                Control.value = String(Coordinate);
                Control.dispatchEvent(new Event('input', {bubbles: true}));
            }, Index);
            await RequireNativeImages(Page, ['#motion-lit', '#motion-night', '#motion-distance']);
            const Suffix = String(Index).padStart(2, '0');
            Assert.equal(await Page.locator('#motion-lit').getAttribute('src'), 'Images/MotionLit' + Suffix + '.png');
            Assert.equal(await Page.locator('#motion-night').getAttribute('src'), 'Images/Motion' + Suffix + '.png');
            Assert.equal(await Page.locator('#motion-distance').getAttribute('src'), 'Images/Motion' + Suffix + 'Distance.png');
            Assert.match(await Page.locator('#motion-time').textContent(), new RegExp('Pose ' + Index + ' /'));
        }
        await Page.click('#motion-play');
        await Page.waitForFunction(() => document.querySelector('#motion-scrub').value !== '11', null, {timeout: 2000});
        await Page.click('#motion-play');
        Assert.equal(await Page.locator('#motion-play').textContent(), 'Play');

        const LocalLinks = await Page.locator('a[href]').evaluateAll(Controls => Controls
            .map(Control => Control.getAttribute('href'))
            .filter(Href => !Href.startsWith('#') && !/^https?:/.test(Href)));
        for (const Href of new Set(LocalLinks))
        {
            const Response = await Page.request.get(new URL(Href, BaseUrl).href);
            Assert.equal(Response.status(), 200, 'Broken local evidence link: ' + Href);
        }
        const BrokenImages = await Page.locator('img').evaluateAll(Pictures => Pictures
            .filter(Picture => !Picture.complete || Picture.naturalWidth === 0).map(Picture => Picture.src));
        Assert.deepEqual(BrokenImages, []);
        Assert.deepEqual(Failures, []);
        Assert.deepEqual(Responses, []);

        await Page.selectOption('#shadow-choice', 'LocalVoxelPenumbra');
        await Page.selectOption('#source-choice', 'Emissive');
        await Page.locator('#motion-scrub').evaluate(Control =>
        {
            Control.value = '0';
            Control.dispatchEvent(new Event('input', {bubbles: true}));
        });
        await Page.evaluate(() => scrollTo(0, 0));
        await Page.screenshot({path: Path.join(Exhibit, 'Images/Presentation.png')});
        await Page.setViewportSize({width: 390, height: 844});
        const Overflow = await Page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        Assert.equal(Overflow, false, 'Evidence viewer overflows the mobile viewport');
        await Page.screenshot({path: Path.join(Exhibit, 'Images/PresentationMobile.png')});

        // An unloaded report must visibly fail, rather than silently masquerading as accepted evidence.
        const MissingReport = await Context.newPage();
        await MissingReport.route('**/Results/Benchmark.json', Route => Route.fulfill({status: 404, body: 'missing'}));
        await MissingReport.goto(BaseUrl, {waitUntil: 'networkidle'});
        await MissingReport.waitForFunction(() => document.querySelector('#load-status').className === 'error');
        Assert.match(await MissingReport.locator('#load-status').textContent(), /Evidence load failed: Benchmark: HTTP 404/);
        Assert.equal(await MissingReport.locator('#ray-count').textContent(), 'Loading…');
        await MissingReport.close();

        const Report = {
            passed: true,
            browser: await Browser.version(),
            executable_sha256: Digest(Executable),
            html_sha256: Digest(Path.join(Exhibit, 'index.html')),
            test_source_sha256: Digest(__filename),
            shadow_selections: ShadowSelections.length,
            source_selections: SourceSelections.length,
            matched_motion_pose_selections: 12,
            motion_play_pause_exercised: true,
            reduced_motion_respected: true,
            local_evidence_links_checked: new Set(LocalLinks).size,
            missing_report_negative_control_rejected: true,
            unanticipated_http_errors: Responses,
            javascript_or_request_failures: Failures,
            desktop_viewport: [1440, 1050],
            mobile_viewport: [390, 844],
            mobile_horizontal_overflow: Overflow,
            scope: 'Retained HTML evidence viewer only. Screenshots are not the native editor or a GPU-rendered scene.'
        };
        FileSystem.writeFileSync(ReportPath, JSON.stringify(Report, null, 2) + '\n');
        console.log(JSON.stringify(Report, null, 2));
    }
    finally
    {
        await Browser.close();
    }
}

Execute().catch(Failure =>
{
    FileSystem.writeFileSync(ReportPath, JSON.stringify({passed: false, failure: Failure.message}, null, 2) + '\n');
    console.error(Failure);
    process.exitCode = 1;
});
