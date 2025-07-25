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

        const baseUrl = new URL(startUrl).origin;
        const axiosInstance = axios.create({
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });

        // Step 1: Get all chapter links from the list page
        console.log('Fetching chapter list...');
        const listUrl = startUrl.includes('/book/') 
            ? startUrl.replace(/\/book\/\d+\/\d+\.html$/, '')
            : startUrl;

        const listResponse = await axiosInstance.get(listUrl);
        const $list = cheerio.load(listResponse.data);

        // Extract all chapter links from the list
        const chapterLinks = [];
        $list('#list-chapterAll dd a').each((_, element) => {
            const href = $list(element).attr('href');
            if (href && !href.startsWith('javascript')) {
                chapterLinks.push(new URL(href, baseUrl).href);
            }
        });

        if (chapterLinks.length === 0) {
            throw new Error('No chapter links found');
        }

        console.log(`Found ${chapterLinks.length} chapters to download`);

        // Create results directory
        const resultDir = path.join(__dirname, '../results');
        if (!fs.existsSync(resultDir)) {
            await mkdir(resultDir, { recursive: true });
        }

        // Extract novel ID from URL for filename
        const novelIdMatch = listUrl.match(/book\/(\d+)/);
        const novelId = novelIdMatch ? novelIdMatch[1] : 'novel';
        const outputFile = path.join(resultDir, `${novelId}.json`);
        const result = [];

        // Parallel download queue (5 at a time)
        const queue = new PQueue({ concurrency: 5 });
        let completed = 0;

        // Progress tracker (single-line updates)
        const updateProgress = () => {
            process.stdout.write(`\rDownloading: ${completed}/${chapterLinks.length} chapters`);
        };

        console.log('Starting downloads...');
        updateProgress();

        // Download all chapters in parallel
        await Promise.all(chapterLinks.map((url, index) => {
            return queue.add(async () => {
                try {
                    const response = await axiosInstance.get(url);
                    const $ = cheerio.load(response.data);

                    // Remove unwanted elements
                    $('script, style, iframe, noscript, .ad, .ads').remove();

                    // Extract title and content
                    let title = $('h1.pt10').text().trim();
                    let content = $('div.readcotent.bbb.font-normal').html();

                    // Clean up content
                    if (content) {
                        content = content
                            .replace(/<br\s*\/?>/gi, '\n')
                            .replace(/<\/p><p>/gi, '\n\n')
                            .replace(/<[^>]+>/g, '')
                            .trim();
                    }

                    // Handle missing data cases
                    if (!title && !content) {
                        // Skip entirely if both are missing
                        return;
                    } else if (!content) {
                        content = "Chapter content is missing";
                    } else if (!title) {
                        title = `Chapter ${index + 1}`;
                    }

                    result[index] = { 
                        title, 
                        content 
                    };
                } catch (error) {
                    console.error(`\nError downloading ${url}:`, error.message);
                    // Include a placeholder for failed chapters
                    result[index] = {
                        title: `Chapter ${index + 1} (Failed to download)`,
                        content: `Failed to download content from ${url}`
                    };
                } finally {
                    completed++;
                    updateProgress();
                }
            });
        });

        // Filter out any undefined entries (from skipped chapters)
        const filteredResult = result.filter(chapter => chapter !== undefined);

        // Finalize output
        console.log('\n');
        await writeFile(outputFile, JSON.stringify(filteredResult, null, 2));
        console.log(`Saved ${filteredResult.length} chapters to ${outputFile}`);

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
