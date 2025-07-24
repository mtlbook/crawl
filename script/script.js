const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { promisify } = require('util');
const { default: PQueue } = require('p-queue');

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

async function crawlNovel(startUrl) {
    try {
        console.log(`Starting crawl for URL: ${startUrl}`);

        // Normalize URL (ensure it starts with https://)
        if (!startUrl.startsWith('http')) {
            startUrl = `https://${startUrl}`;
        }

        // Extract novel ID
        const novelIdMatch = startUrl.match(/\/read\/(\d+)/);
        if (!novelIdMatch) throw new Error('Invalid URL format');
        const novelId = novelIdMatch[1];
        const baseUrl = new URL(startUrl).origin;

        // Fetch latest chapter number
        const axiosInstance = axios.create({
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            }
        });

        const mainPage = await axiosInstance.get(startUrl);
        const $main = cheerio.load(mainPage.data);
        const latestChapterUrl = $main('ul.u-chapter.cfirst li a').first().attr('href');
        const latestChapterNum = parseInt(latestChapterUrl.match(/p(\d+)\.html/)[1], 10);

        // Generate all chapter URLs (from latest down to p1.html)
        const chapterUrls = Array.from(
            { length: latestChapterNum },
            (_, i) => `${baseUrl}/read/${novelId}/p${latestChapterNum - i}.html`
        );

        console.log(`Found ${chapterUrls.length} chapters. Starting download...`);

        // Prepare output directory
        const resultDir = path.join(__dirname, '../results');
        if (!fs.existsSync(resultDir)) await mkdir(resultDir, { recursive: true });
        const outputFile = path.join(resultDir, `${novelId}.json`);
        const result = [];

        // Download in parallel (5 at a time)
        const queue = new PQueue({ concurrency: 5 });
        let completed = 0;

        // Single-line progress updater
        const updateProgress = () => {
            process.stdout.write(`\rDownloading: ${completed}/${chapterUrls.length} chapters`);
        };

        await Promise.all(chapterUrls.map((url, index) =>
            queue.add(async () => {
                try {
                    const res = await axiosInstance.get(url);
                    const $ = cheerio.load(res.data);
                    $('script, style, .ad').remove(); // Clean unwanted elements

                    const title = $('article.page-content > h3').text().trim();
                    const content = $('article.page-content section p')
                        .map((_, el) => $(el).text().trim())
                        .get()
                        .join('\n\n');

                    result[index] = { title: title || `Chapter ${index + 1}`, content };
                } catch (error) {
                    result[index] = { title: `Chapter ${index + 1} [Failed]`, content: '' };
                } finally {
                    completed++;
                    updateProgress(); // Update progress in the same line
                }
            })
        );

        console.log('\nDone! Saving results...');
        await writeFile(outputFile, JSON.stringify(result, null, 2));
        console.log(`Saved ${result.length} chapters to ${outputFile}`);

        return outputFile;
    } catch (error) {
        console.error('\nCrawl failed:', error.message);
        throw error;
    }
}

// Execute
const url = process.argv[2] || process.env.INPUT_URL;
if (!url) {
    console.error('Usage: node script.js <URL>');
    process.exit(1);
}

crawlNovel(url)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
