import sys
from pathlib import Path
from loguru import logger

def setup_logging():
    current_dir = Path(__file__).resolve().parent
    base_dir = current_dir.parent.parent
    target_dir = base_dir / "logs"
    target_dir.mkdir(exist_ok=True)
    
    logger.remove()  # Remove default logger
    logger.add(
        sys.stdout, 
        level="INFO", 
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level>| <cyan>{name}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>"
        )
    logger.add(
        target_dir / "app.log", 
        rotation="10 MB", 
        retention=5, 
        encoding="utf-8", 
        enqueue=True, 
        backtrace=True,
        diagnose=True,
        level="INFO", 
        format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {message}"
        )
               