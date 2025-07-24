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
            throw new Error('Invalid URL format');
        }
        const novelId = novelIdMatch[1];
        
        // Create result directory
const resultDir = path.join(__dirname, '../results');
        if (!fs.existsSync(resultDir)) {
            fs.mkdirSync(resultDir, { recursive: true });
        }
        
        const outputFile = path.join(resultDir, `${novelId}.json`);
        const result = [];
        
        const baseUrl = new URL(startUrl).origin;
        let currentUrl = startUrl;
        let hasNextPage = true;
        let pageCount = 0;
        const MAX_PAGES = 6845;

        const axiosInstance = axios.create({
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });

        // Get first chapter
        try {
            const mainPageResponse = await axiosInstance.get(currentUrl);
            const $main = cheerio.load(mainPageResponse.data);
            const firstChapterUrl = $main('ul.u-chapter.cfirst li a').first().attr('href');
            currentUrl = new URL(firstChapterUrl, baseUrl).href;
        } catch (error) {
            console.error('Error getting first chapter:', error.message);
            throw error;
        }
        
        while (hasNextPage && pageCount < MAX_PAGES) {
            try {
                const response = await axiosInstance.get(currentUrl);
                const $ = cheerio.load(response.data);
                
                // Remove ad elements
                $('p.abg, .ad, .ads').remove();
                
                const title = $('article.page-content > h3').text().trim();
                
                // Get clean content without URLs
                let content = '';
                $('article.page-content section p').each((i, el) => {
                    const text = $(el).text().trim();
                    // Remove any remaining URLs
                    content += text.replace(/https?:\/\/[^\s]+/g, '') + '\n\n';
                });
                content = content.trim();
                
                if (title || content) {
                    result.push({
                        title: title || `Chapter ${pageCount + 1}`,
                        content
                    });
                }
                
                if (currentUrl.endsWith('p1.html')) {
                    hasNextPage = false;
                    break;
                }
                
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
        
        fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
        console.log(`Crawl completed. Saved ${result.length} chapters to ${outputFile}`);
        
        return outputFile;
    } catch (error) {
        console.error('Crawl failed:', error.message);
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
