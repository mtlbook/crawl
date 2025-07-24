// scripts/crawler.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const RESULTS_DIR = path.join(__dirname, '../results');
const BASE_URLS = [
  'https://ixdzs8.tw/',
  'https://ixdzs8.com/',
  'https://tw.m.ixdzs.com/',
  'https://www.aixdzs.com'
];
const SEARCH_URL = 'https://ixdzs.tw/bsearch?q=';

class IxdzsCrawler {
  constructor() {
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
      const response = await axios.get(url);
      return cheerio.load(response.data);
    } catch (error) {
      console.error(`Error fetching ${url}:`, error.message);
      return null;
    }
  }

  rectifyUrl(url) {
    url = url.endsWith('/') ? url.slice(0, -1) : url;
    if (url.includes('https://ixdzs.tw')) {
      return url.replace('https://ixdzs.tw', 'https://ixdzs.tw');
    }
    if (url.includes('https://www.aixdzs.com')) {
      return url.replace('https://www.aixdzs.com', 'https://ixdzs8.com');
    }
    return url;
  }

  absoluteUrl(url, base) {
    if (url.startsWith('http')) return url;
    return new URL(url, base).href;
  }

  async searchNovel(query) {
    const searchQuery = query.toLowerCase().replace(/\s+/g, '+');
    const $ = await this.getSoup(`${SEARCH_URL}${searchQuery}`);
    if (!$) return [];

    const results = [];
    $('main > div.panel > ul.u-list > li.burl').each((i, el) => {
      const title = $(el).find('h3 a').text().trim();
      const url = this.absoluteUrl($(el).find('h3 a').attr('href'), BASE_URLS[0]);
      results.push({ title, url });
    });

    return results;
  }

  async readNovelInfo(novelUrl) {
    this.novelInfo.url = this.rectifyUrl(novelUrl);
    const $ = await this.getSoup(this.novelInfo.url);
    if (!$) return;

    const content = $('div.novel');
    const metadata = content.find('div.n-text');

    // Get title
    this.novelInfo.title = metadata.find('h1').text().trim();
    console.log(`Novel title: ${this.novelInfo.title}`);

    // Get author
    this.novelInfo.author = metadata.find('a.bauthor').text().trim();
    console.log(`Novel author: ${this.novelInfo.author}`);

    // Get cover
    const coverImg = content.find('div.n-img > img');
    if (coverImg.length) {
      this.novelInfo.cover = this.absoluteUrl(coverImg.attr('src'), this.novelInfo.url);
    }
    console.log(`Novel cover: ${this.novelInfo.cover}`);

    // Get synopsis
    const synopsis = $('p#intro');
    if (synopsis.length) {
      this.novelInfo.synopsis = synopsis.text().trim();
    }

    // Get chapters
    console.log('Getting chapters...');
    const lastChapLink = $('ul.u-chapter > li:nth-child(1) > a');
    const lastChapUrl = this.absoluteUrl(lastChapLink.attr('href'), this.novelInfo.url);
    const lastChapId = parseInt(lastChapUrl.split('/').pop().replace('p', '').replace('.html', '').trim());

    for (let chapId = 1; chapId <= lastChapId; chapId++) {
      if (this.novelInfo.chapters.length % 100 === 0) {
        const volId = Math.floor(chapId / 100) + 1;
        this.novelInfo.volumes.push({
          id: volId,
          title: `Volume ${volId}`
        });
      }
      this.novelInfo.chapters.push({
        id: chapId,
        title: `Chapter ${chapId}`,
        url: `${this.novelInfo.url}/p${chapId}.html`
      });
    }
  }

  async downloadChapterBody(chapterUrl) {
    console.log(`Downloading ${chapterUrl}`);
    const $ = await this.getSoup(chapterUrl);
    if (!$) return '';

    // Update chapter title if available
    const chapterTitle = $('article.page-content > h3');
    let content = '';
    if (chapterTitle.length) {
      content += `<h3>${chapterTitle.text().trim()}</h3>\n`;
    }

    // Get chapter content
    const paragraphs = [];
    $('article.page-content section p').each((i, el) => {
      paragraphs.push($(el).html());
    });

    content += paragraphs.join('\n');
    return content;
  }

  async saveResults(filename) {
    if (!fs.existsSync(RESULTS_DIR)) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }
    const filePath = path.join(RESULTS_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(this.novelInfo, null, 2));
    console.log(`Results saved to ${filePath}`);
  }
}

// Main execution
async function main() {
  const [query, specificUrl] = process.argv.slice(2);
  const crawler = new IxdzsCrawler();

  if (specificUrl) {
    // Crawl specific novel
    await crawler.readNovelInfo(specificUrl);
    
    // Download first 3 chapters for demo (to avoid too many requests)
    for (const chapter of crawler.novelInfo.chapters.slice(0, 3)) {
      chapter.content = await crawler.downloadChapterBody(chapter.url);
    }
    
    await crawler.saveResults(`${crawler.novelInfo.title.replace(/\s+/g, '_')}.json`);
  } else {
    // Search for novels
    const results = await crawler.searchNovel(query);
    await crawler.saveResults(`search_results_${query.replace(/\s+/g, '_')}.json`);
    console.log('Search results:', results);
  }
}

main().catch(console.error);
