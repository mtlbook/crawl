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

        // Normalize URL (add https:// if missing)
        if (!startUrl.startsWith('http')) {
            startUrl = `https://${startUrl}`;
        }

        // Extract novel ID and starting chapter number
        const novelIdMatch = startUrl.match(/\/read\/(\d+)/);
        if (!novelIdMatch) throw new Error('Invalid URL format');
        const novelId = novelIdMatch[1];

        // Get the latest chapter from the main page
        const baseUrl = new URL(startUrl).origin;
        const axiosInstance = axios.create({
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });

        // Fetch the latest chapter number
        const mainPageResponse = await axiosInstance.get(startUrl);
        const $main = cheerio.load(mainPageResponse.data);
        const latestChapterUrl = $main('ul.u-chapter.cfirst li a').first().attr('href');
        const latestChapterMatch = latestChapterUrl.match(/p(\d+)\.html/);
        if (!latestChapterMatch) throw new Error('Could not extract latest chapter number');
        const latestChapter = parseInt(latestChapterMatch[1], 10);

        // Generate all chapter URLs (from latest down to 1)
        const chapterUrls = Array.from({ length: latestChapter }, (_, i) => 
            `${baseUrl}/read/${novelId}/p${latestChapter - i}.html`
        );

        console.log(`Found ${chapterUrls.length} chapters to download`);

        // Create results directory
        const resultDir = path.join(__dirname, '../results');
        if (!fs.existsSync(resultDir)) {
            await mkdir(resultDir, { recursive: true });
        }

        const outputFile = path.join(resultDir, `${novelId}.json`);
        const result = [];

        // Parallel download queue (5 at a time)
        const queue = new PQueue({ concurrency: 5 });
        let completed = 0;

        // Progress tracker (single-line updates)
        const updateProgress = () => {
            process.stdout.write(`\rDownloading: ${completed}/${chapterUrls.length} chapters`);
        };

        console.log('Starting downloads...');
        updateProgress();

        // Download all chapters in parallel
        await Promise.all(chapterUrls.map((url, index) =>
            queue.add(async () => {
                try {
                    const response = await axiosInstance.get(url);
                    const $ = cheerio.load(response.data);

                    // Remove unwanted elements
                    $('script, style, iframe, noscript, p.abg, .ad, .ads').remove();

                    const title = $('article.page-content > h3').text().trim();
                    let content = $('article.page-content section p')
                        .map((_, el) => $(el).text().trim().replace(/https?:\/\/[^\s]+/g, ''))
                        .get()
                        .join('\n\n');

                    // Store in reverse order (we'll reverse the array later)
                    result[chapterUrls.length - 1 - index] = { 
                        title: title || `Chapter ${chapterUrls.length - index}`, 
                        content 
                    };
                } catch (error) {
                    console.error(`\nError downloading ${url}:`, error.message);
                    result[chapterUrls.length - 1 - index] = { 
                        title: `Chapter ${chapterUrls.length - index} [Failed]`, 
                        content: '' 
                    };
                } finally {
                    completed++;
                    updateProgress();
                }
            })
        ));

        // Finalize output (no need to reverse since we stored in correct order)
        console.log('\n');
        await writeFile(outputFile, JSON.stringify(result, null, 2));
        console.log(`Saved ${result.length} chapters to ${outputFile}`);

        return outputFile;
    } catch (error) {
        console.error('\nCrawl failed:', error.message);
        throw error;
    }
}

// Run
const url = process.argv[2] || process.env.INPUT_URL;
if (!url) {
    console.error('Please provide a URL');
    process.exit(1);
}

crawlNovel(url)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
