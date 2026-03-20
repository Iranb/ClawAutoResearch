---
name: scrapling
description: Adaptive Web Scraping framework handling everything from single requests to full-scale crawls. Use when you need to scrape websites, bypass anti-bot protections (Cloudflare), or build complex spiders.
---

# Scrapling

## Overview

Scrapling is an adaptive Web Scraping framework that handles everything from a single request to a full-scale crawl.
It features intelligent element tracking, anti-bot bypass capabilities (Cloudflare Turnstile), and a Scrapy-like Spider API.

## When to Use This Skill

Use this skill when:
- You need to scrape data from websites, especially those with anti-bot protections.
- You want to build robust spiders that can handle website changes.
- You need to perform concurrent crawling or multi-session scraping.
- You want to use a modern, Pythonic scraping library.

## Getting Started

### Installation

To install Scrapling with all features:

```bash
pip install "scrapling[fetchers]"
scrapling install
```

### Basic Usage

For simple scraping tasks, use the `Fetcher` or `StealthyFetcher` classes.

```python
from scrapling.fetchers import Fetcher, StealthyFetcher

# Standard fetch
page = Fetcher.get('https://example.com')
title = page.css('h1::text').get()

# Stealthy fetch (bypasses anti-bot)
page = StealthyFetcher.fetch('https://protected-site.com')
data = page.css('.content').getall()
```

See `references/scrapling_guide.md` for more detailed usage instructions, including session management and advanced selectors.

## Creating Spiders

For more complex crawling tasks, use the `Spider` class.

You can generate a basic spider template using the included script:

```bash
python3 scripts/create_spider.py my_spider https://example.com
```

This will create a `my_spider_spider.py` file with a basic spider structure.

## Resources

### scripts/

- `create_spider.py`: Generates a basic Scrapling spider template.

### references/

- `scrapling_guide.md`: Detailed guide on using Scrapling, including installation, basic usage, spiders, and selectors.
