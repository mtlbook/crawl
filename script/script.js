const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

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
            throw new Error('Invalid URL format. Please provide a URL like https://ixdzs.tw/read/212475');
        }
        const novelId = novelIdMatch[1];
        
        // Create result directory if it doesn't exist
        const resultDir = path.join(__dirname, 'result');
        if (!fs.existsSync(resultDir)) {
            fs.mkdirSync(resultDir, { recursive: true });
        }
        
        const outputFile = path.join(resultDir, `${novelId}.json`);
        const result = [];
        
        const baseUrl = new URL(startUrl).origin;
        let currentUrl = startUrl;
        let hasNextPage = true;
        let pageCount = 0;
        const MAX_PAGES = 10; // Safety limit
        
        // First, get the first chapter URL from the main page
        try {
            console.log(`Fetching main page: ${currentUrl}`);
            const mainPageResponse = await axios.get(currentUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                },
                timeout: 1000
            });
            
            const $main = cheerio.load(mainPageResponse.data);
            const firstChapterUrl = $main('ul.u-chapter.cfirst li a').first().attr('href');
            
            if (!firstChapterUrl) {
                throw new Error('Could not find first chapter link');
            }
            
            currentUrl = new URL(firstChapterUrl, baseUrl).href;
            console.log(`First chapter URL: ${currentUrl}`);
        } catch (error) {
            console.error('Error getting first chapter:', error.message);
            throw error;
        }
        
        while (hasNextPage && pageCount < MAX_PAGES) {
            try {
                console.log(`Crawling page ${pageCount + 1}: ${currentUrl}`);
                const response = await axios.get(currentUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    },
                    timeout: 1000
                });
                
                const $ = cheerio.load(response.data);
                
                // Extract title and content
                const title = $('article.page-content h3').text().trim();
                let content = $('article.page-content section').html();
                
                // Clean up content - keep only text and <p> tags
                if (content) {
                    const $content = cheerio.load(content);
                    $content('*').not('p, br').each(function() {
                        $content(this).replaceWith($content(this).text());
                    });
                    content = $content('body').html();
                }
                
                if (title && content) {
                    result.push({
                        url: currentUrl,
                        title,
                        content
                    });
                } else {
                    console.warn('No title or content found on page');
                }
                
                // Check if we've reached p1.html
                if (currentUrl.endsWith('p1.html')) {
                    console.log('Reached p1.html - ending crawl');
                    hasNextPage = false;
                    break;
                }
                
                // Find previous chapter link
                const prevLink = $('a:contains("上一章")').attr('href');
                if (prevLink) {
                    currentUrl = new URL(prevLink, baseUrl).href;
                    pageCount++;
                } else {
                    console.log('No previous chapter link found - ending crawl');
                    hasNextPage = false;
                }
            } catch (error) {
                console.error(`Error crawling ${currentUrl}:`, error.message);
                hasNextPage = false;
            }
        }
        
        // Save results to JSON file
        fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
        console.log(`Crawl completed. ${result.length} chapters saved to ${outputFile}`);
        
        return {
            outputFile,
            chapterCount: result.length
        };
    } catch (error) {
        console.error('Error during crawl:', error.message);
        throw error;
    }
}

// Get URL from command line argument or GitHub Actions input
const url = process.argv[2] || process.env.INPUT_URL;
if (!url) {
    console.error('Please provide a URL as an argument or through INPUT_URL environment variable');
    process.exit(1);
}

crawlNovel(url)
    .then(({ outputFile, chapterCount }) => {
        console.log(`Successfully crawled ${chapterCount} chapters`);
        console.log(`Results saved to: ${outputFile}`);
        process.exit(0);
    })
    .catch(err => {
        console.error('Crawl failed:', err);
        process.exit(1);
    });
