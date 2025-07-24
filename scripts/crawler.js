const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

// Ensure results directory exists
const RESULTS_DIR = path.join(__dirname, '../results');
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

class IxdzsCrawler {
  constructor() {
    this.results = [];
    this.novelInfo = {
      title: '',
      author: '',
      cover: '',
      synopsis: '',
      volumes: [],
      chapters: []
    };
  }

  async getSoup(url) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      return cheerio.load(response.data);
    } catch (error) {
      console.error(`Error fetching ${url}:`, error.message);
      return null;
    }
  }

  async searchNovel(query) {
    const searchUrl = `https://ixdzs8.tw/bsearch?q=${encodeURIComponent(query)}`;
    const $ = await this.getSoup(searchUrl);
    if (!$) return [];

    const results = [];
    $('main > div.panel > ul.u-list > li.burl').each((i, el) => {
      results.push({
        title: $(el).find('h3 a').text().trim(),
        url: $(el).find('h3 a').attr('href')
      });
    });

    // Save search results
    fs.writeFileSync(
      path.join(RESULTS_DIR, `search_${query.replace(/\s+/g, '_')}.json`),
      JSON.stringify(results, null, 2)
    );
    
    return results;
  }

  async crawlNovel(url) {
    const $ = await this.getSoup(url);
    if (!$) return;

    // Extract novel info
    this.novelInfo.title = $('div.n-text h1').text().trim();
    this.novelInfo.author = $('div.n-text a.bauthor').text().trim();
    this.novelInfo.cover = $('div.n-img img').attr('src') || '';
    this.novelInfo.synopsis = $('p#intro').text().trim();

    // Extract chapters
    const lastChapterUrl = $('ul.u-chapter > li:nth-child(1) > a').attr('href');
    const lastChapterNum = parseInt(lastChapterUrl.match(/p(\d+)\.html/)[1]);

    for (let i = 1; i <= lastChapterNum; i++) {
      if (i % 100 === 1) {
        this.novelInfo.volumes.push({
          id: Math.floor(i / 100) + 1,
          title: `Volume ${Math.floor(i / 100) + 1}`
        });
      }
      
      this.novelInfo.chapters.push({
        id: i,
        title: `Chapter ${i}`,
        url: `${url.replace(/\/$/, '')}/p${i}.html`
      });
    }

    // Save novel info
    const filename = `novel_${this.novelInfo.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
    fs.writeFileSync(
      path.join(RESULTS_DIR, filename),
      JSON.stringify(this.novelInfo, null, 2)
    );

    return this.novelInfo;
  }
}

// Main execution
async function main() {
  const [query, novelUrl] = process.argv.slice(2);
  const crawler = new IxdzsCrawler();

  if (novelUrl) {
    console.log(`Crawling novel at ${novelUrl}`);
    await crawler.crawlNovel(novelUrl);
  } else {
    console.log(`Searching for novels with query: ${query}`);
    const results = await crawler.searchNovel(query);
    console.log(`Found ${results.length} results`);
  }
}

main().catch(console.error);
