const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

async function crawlNovel(startUrl) {
    try {
        // Extract novel ID from URL
        const novelIdMatch = startUrl.match(/\/read\/(\d+)/);
        if (!novelIdMatch) {
            throw new Error('Invalid URL format. Please provide a URL like https://ixdzs.tw/read/212475');
        }
        const novelId = novelIdMatch[1];
        
        // Create result directory if it doesn't exist
        const resultDir = path.join(__dirname, 'result');
        if (!fs.existsSync(resultDir)) {
            fs.mkdirSync(resultDir);
        }
        
        const outputFile = path.join(resultDir, `${novelId}.json`);
        const result = [];
        
        let currentUrl = startUrl;
        let hasNextPage = true;
        let pageCount = 0;
        
        // First, get the first chapter URL from the main page
        const mainPageResponse = await axios.get(startUrl);
        const $main = cheerio.load(mainPageResponse.data);
        const firstChapterUrl = $main('ul.u-chapter.cfirst li a').first().attr('href');
        
        if (!firstChapterUrl) {
            throw new Error('Could not find first chapter link');
        }
        
        // Construct full URL for first chapter
        const baseUrl = new URL(startUrl).origin;
        currentUrl = new URL(firstChapterUrl, baseUrl).href;
        
        console.log(`Starting crawl from: ${currentUrl}`);
        
        while (hasNextPage && pageCount < 1000) { // Safety limit
            try {
                console.log(`Crawling: ${currentUrl}`);
                const response = await axios.get(currentUrl);
                const $ = cheerio.load(response.data);
                
                // Extract title and content
                const title = $('article.page-content h3').text().trim();
                let content = $('article.page-content section').html();
                
                // Clean up content - keep only text and <p> tags
                if (content) {
                    const $content = cheerio.load(content);
                    $content('*').not('p').each(function() {
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
                }
                
                // Check if we've reached p1.html
                if (currentUrl.endsWith('p1.html')) {
                    hasNextPage = false;
                    break;
                }
                
                // Find previous chapter link
                const prevLink = $('a:contains("上一章")').attr('href');
                if (prevLink) {
                    currentUrl = new URL(prevLink, baseUrl).href;
                    pageCount++;
                } else {
                    hasNextPage = false;
                }
            } catch (error) {
                console.error(`Error crawling ${currentUrl}:`, error.message);
                hasNextPage = false;
            }
        }
        
        // Save results to JSON file
        fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
        console.log(`Crawl completed. Results saved to ${outputFile}`);
        
        return outputFile;
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

crawlNovel(url).catch(err => {
    console.error('Crawl failed:', err);
    process.exit(1);
});
