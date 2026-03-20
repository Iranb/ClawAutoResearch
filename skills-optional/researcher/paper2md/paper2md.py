import requests
import sys
import os
import argparse
import time
from pathlib import Path

def main():
    start_time = time.time()
    parser = argparse.ArgumentParser(description="MinerU Client")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("--url", default="http://211.71.76.29:8000/parse", help="Server URL")
    parser.add_argument("--full", action="store_true", help="Download full output (zip) instead of just Markdown")
    parser.add_argument("-o", "--output", default=None, help="Output file or directory path (default: current dir, same stem as PDF)")
    
    args = parser.parse_args()
        
    pdf_path = Path(args.pdf_path)
    if not pdf_path.exists():
        print(f"Error: File {pdf_path} not found")
        sys.exit(1)

    url = args.url
    
    print(f"Uploading {pdf_path} to {url}...")
    
    params = {}
    if not args.full:
        params['return_md_only'] = 'true'
    
    try:
        with open(pdf_path, 'rb') as f:
            files = {'file': f}
            # 设置较长的超时时间，因为 PDF 处理可能很慢
            # stream=True 允许我们流式处理响应
            response = requests.post(url, files=files, params=params, stream=True, timeout=3600)
            
        if response.status_code == 200:
            # 确定保存路径
            if not args.full:
                default_name = f"{pdf_path.stem}.md"
            else:
                default_name = f"{pdf_path.name}.zip"
            if args.output is not None:
                out = Path(args.output)
                if out.suffix in ('.md', '.zip'):
                    output_path = out
                else:
                    out.mkdir(parents=True, exist_ok=True)
                    output_path = out / default_name
            else:
                output_path = Path(default_name)
            
            print(f"Processing complete. Downloading to {output_path}...")
            
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        
            print(f"Successfully saved to {output_path.absolute()}")
        else:
            print(f"Failed to process {pdf_path}, status code: {response.status_code}")
            try:
                print(response.json())
            except:
                print(response.text)
                
    except requests.exceptions.Timeout:
        print("Error: Request timed out. The server took too long to respond.")
    except requests.exceptions.ConnectionError:
        print("Error: Could not connect to the server. Check if the server is running and accessible.")
    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        end_time = time.time()
        print(f"Total time elapsed: {end_time - start_time:.2f} seconds")

if __name__ == "__main__":
    main()
