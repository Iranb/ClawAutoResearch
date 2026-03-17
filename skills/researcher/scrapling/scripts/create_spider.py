import argparse
import os

TEMPLATE = """from scrapling.spiders import Spider, Request, Response

class {class_name}(Spider):
    name = "{spider_name}"
    start_urls = {start_urls}
    
    async def parse(self, response: Response):
        # Extract items
        for item in response.css('.item'):
            yield {{
                "title": item.css('h2::text').get(),
                "link": item.css('a::attr(href)').get(),
            }}
            
        # Follow pagination links
        next_page = response.css('.next a::attr(href)').get()
        if next_page:
            yield response.follow(next_page)

if __name__ == "__main__":
    {class_name}().start()
"""

def create_spider(name, url, filename):
    class_name = name.capitalize() + "Spider"
    start_urls = [url]
    
    content = TEMPLATE.format(
        class_name=class_name,
        spider_name=name,
        start_urls=start_urls
    )
    
    with open(filename, 'w') as f:
        f.write(content)
    
    print(f"Created spider {name} in {filename}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create a basic Scrapling spider.")
    parser.add_argument("name", help="Name of the spider")
    parser.add_argument("url", help="Start URL")
    parser.add_argument("--filename", help="Output filename", default=None)
    
    args = parser.parse_args()
    
    filename = args.filename or f"{args.name}_spider.py"
    create_spider(args.name, args.url, filename)
