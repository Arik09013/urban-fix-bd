// generate_docs.js - Compiles the complete Urban Fix BD Technical Documentation into an A4 PDF
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUTPUT_PDF_PATH = path.resolve("..", "Urban_Fix_BD_Technical_Documentation.pdf");
const LOCAL_COPY_PATH = path.resolve(".", "Urban_Fix_BD_Technical_Documentation.pdf");

console.log("Preparing Urban Fix BD Comprehensive Technical Documentation...");
