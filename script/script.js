const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { promisify } = require('util');
const { default: PQueue } = require('p-queue');

// Promisify file operations
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

async function crawlNovel(startUrl) {
    try {
        console.log(`Starting crawl for URL: ${startUrl}`);
        
        // Validate and normalize URL
        if (!startUrl.startsWith('http')) {
            startUrl = `https://${startUrl}`;
        }
        
        // Extract novel ID from URL
        const novelIdMatch = startUrl.match(/\/read\/(\d+)/);
        if (!novelIdMatch) {
            throw new Error('Invalid URL format');
        }
        const novelId = novelIdMatch[1];
        
        // Create result directory
        const resultDir = path.join(__dirname, '../results');
        if (!fs.existsSync(resultDir)) {
            await mkdir(resultDir, { recursive: true });
        }
        
        const outputFile = path.join(resultDir, `${novelId}.json`);
        const result = [];
        
        const baseUrl = new URL(startUrl).origin;
        let currentUrl = startUrl;

        const axiosInstance = axios.create({
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });

        // Get first chapter and chapter list
        let chapterUrls = [];
        try {
            const mainPageResponse = await axiosInstance.get(currentUrl);
            const $main = cheerio.load(mainPageResponse.data);
            
            // Get all chapter links
            $main('ul.u-chapter.cfirst li a').each((i, el) => {
                const chapterUrl = $main(el).attr('href');
                if (chapterUrl) {
                    chapterUrls.push(new URL(chapterUrl, baseUrl).href);
                }
            });

            if (chapterUrls.length === 0) {
                throw new Error('No chapters found');
            }

            console.log(`Found ${chapterUrls.length} chapters`);
        } catch (error) {
            console.error('Error getting chapter list:', error.message);
            throw error;
        }

        // Limit to MAX_CHAPTERS for safety
        const MAX_CHAPTERS = 50;
        chapterUrls = chapterUrls.slice(0, MAX_CHAPTERS);
        
        // Create a queue for parallel downloads with concurrency control
        const queue = new PQueue({
            concurrency: 5, // Number of parallel downloads
            timeout: 30000
        });

        let completed = 0;
        const totalChapters = chapterUrls.length;
        
        // Progress tracking
        const updateProgress = () => {
            process.stdout.write(`\rDownloading: ${completed}/${totalChapters} chapters [${'#'.repeat(Math.floor(completed/totalChapters*20))}${'-'.repeat(20-Math.floor(completed/totalChapters*20))}]`);
        };

        console.log('Starting parallel downloads...');
        updateProgress();

        // Process each chapter in parallel
        const promises = chapterUrls.map((chapterUrl, index) => 
            queue.add(async () => {
                try {
                    const response = await axiosInstance.get(chapterUrl);
                    const $ = cheerio.load(response.data);
                    
                    // Remove unwanted elements
                    $('script, style, iframe, noscript, p.abg, .ad, .ads').remove();
                    
                    const title = $('article.page-content > h3').text().trim();
                    
                    // Get clean content
                    let content = '';
                    $('article.page-content section p').each((i, el) => {
                        const text = $(el).text().trim();
                        content += text.replace(/https?:\/\/[^\s]+/g, '') + '\n\n';
                    });
                    content = content.trim();
                    
                    if (title || content) {
                        result.push({
                            title: title || `Chapter ${index + 1}`,
                            content,
                            url: chapterUrl
                        });
                    }
                } catch (error) {
                    console.error(`\nError crawling ${chapterUrl}:`, error.message);
                    result.push({
                        title: `Chapter ${index + 1} [Failed to download]`,
                        content: '',
                        url: chapterUrl
                    });
                } finally {
                    completed++;
                    updateProgress();
                }
            })
        );

        // Wait for all downloads to complete
        await Promise.all(promises);
        
        // Sort chapters by their order in the original list
        result.sort((a, b) => {
            const aIndex = chapterUrls.indexOf(a.url);
            const bIndex = chapterUrls.indexOf(b.url);
            return aIndex - bIndex;
        });

        // Clean up URLs from final result
        const finalResult = result.map(chapter => ({
            title: chapter.title,
            content: chapter.content
        }));

        // Move to new line after progress bar
        console.log('\n');
        
        await writeFile(outputFile, JSON.stringify(finalResult, null, 2));
        console.log(`Crawl completed. Saved ${finalResult.length} chapters to ${outputFile}`);
        
        return outputFile;
    } catch (error) {
        console.error('\nCrawl failed:', error.message);
        throw error;
    }
}

// Execute
const url = process.argv[2] || process.env.INPUT_URL;
if (!url) {
    console.error('Please provide a URL');
    process.exit(1);
}

crawlNovel(url)
    .then(outputFile => process.exit(0))
    .catch(() => process.exit(1));
