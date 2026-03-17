# Scrapling Guide

## Installation

```bash
pip install scrapling
# For all features (fetchers, etc.)
pip install "scrapling[fetchers]"
# Install browsers
scrapling install
```

## Basic Usage

### Fetcher (Standard HTTP)

```python
from scrapling.fetchers import Fetcher

# Simple GET request
page = Fetcher.get('https://quotes.toscrape.com/')
quotes = page.css('.quote .text::text').getall()
```

### StealthyFetcher (Anti-bot Bypass)

Use this for sites with Cloudflare or other protections.

```python
from scrapling.fetchers import StealthyFetcher

# Opens a stealthy browser, fetches, then closes
page = StealthyFetcher.fetch('https://nopecha.com/demo/cloudflare')
data = page.css('#padded_content a').getall()
```

### DynamicFetcher (Full Browser Automation)

Use this for dynamic websites that require JavaScript rendering.

```python
from scrapling.fetchers import DynamicFetcher

# Opens a browser, fetches, then closes
page = DynamicFetcher.fetch('https://quotes.toscrape.com/')
data = page.css('.quote .text::text').getall()
```

## Session Management

Use `FetcherSession`, `StealthySession`, or `DynamicSession` to maintain state (cookies, etc.).

```python
from scrapling.fetchers import FetcherSession

with FetcherSession(impersonate='chrome') as session:
    page = session.get('https://quotes.toscrape.com/')
    # ...
```

## Spiders

Scrapling provides a Scrapy-like API for building spiders.

```python
from scrapling.spiders import Spider, Request, Response

class MySpider(Spider):
    name = "myspider"
    start_urls = ["https://quotes.toscrape.com/"]
    
    async def parse(self, response: Response):
        for quote in response.css('.quote'):
            yield {
                "text": quote.css('.text::text').get(),
                "author": quote.css('.author::text').get(),
            }
            
        next_page = response.css('.next a')
        if next_page:
            yield response.follow(next_page[0].attrib['href'])

# Run the spider
MySpider().start()
```

## Selectors

Scrapling supports CSS, XPath, and more.

- `response.css('selector')`
- `response.xpath('//selector')`
- `response.find_all('tag', class_='classname')` (BeautifulSoup style)
- `response.find_by_text('text')`

## Adaptive Scraping

Scrapling can adapt to website changes.

```python
# Enable adaptive mode
products = page.css('.product', adaptive=True)
```
