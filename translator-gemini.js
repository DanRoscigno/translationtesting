import fs from 'fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkFrontmatter from 'remark-frontmatter';
import remarkDirective from 'remark-directive';
import remarkStringify from 'remark-stringify';
import { visit } from 'unist-util-visit';
import yaml from 'js-yaml';
import { read } from 'to-vfile';
import { reporter } from 'vfile-reporter';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ==========================================
// 1. CONFIGURATION
// ==========================================

const FRONTMATTER_KEYS = ['title', 'description', 'sidebar_label', 'summary'];
const JSX_PROPS = ['title', 'label', 'alt', 'placeholder'];
const TARGET_LANG = "Spanish"; 

// API Config
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;

// Initialize API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// *** UPDATED: Using the specific model from your list ***
// We strip the 'models/' prefix as the SDK often prefers just the ID
const MODEL_NAME = "gemini-2.0-flash"; 
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

console.log(`🚀 Initializing with model: ${MODEL_NAME}`);

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// 3. ROBUST TRANSLATION LOGIC
// ==========================================

async function translateTextWithGemini(text) {
  if (!text || !text.trim()) return text;

  // Simple in-memory cache
  if (global.translationCache && global.translationCache[text]) {
    return global.translationCache[text];
  }

  const prompt = `Translate the following technical documentation text into ${TARGET_LANG}. 
  Do not add explanations, quotes, or conversational filler. 
  Maintain all Markdown syntax, variables, and formatting exactly.
  
  Text: "${text}"
  Translation:`;

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const translation = response.text().trim().replace(/^"|"$/g, '');
      
      // Cache success
      global.translationCache = global.translationCache || {};
      global.translationCache[text] = translation;
      
      return translation;

    } catch (error) {
      attempt++;
      
      // Fatal Errors (Don't retry)
      if (error.status === 400 || error.status === 401 || error.status === 404) {
        console.error(`❌ Fatal API Error (Status ${error.status}): ${error.message}`);
        return text; // Return original on fatal error
      }

      // Retryable Errors logic
      const isRetryable = 
        error.status === 429 || 
        error.status === 503 || 
        error.status === 500 || 
        error.message.includes("RESOURCE_EXHAUSTED") || 
        error.message.includes("Overloaded");

      if (!isRetryable) {
        console.error(`❌ Unknown Error: ${error.message}`);
        return text; 
      }

      if (attempt >= MAX_RETRIES) {
        console.error(`❌ Max Retries hit for "${text.substring(0, 15)}..."`);
        return text; 
      }

      // Backoff + Jitter
      const exponentialDelay = Math.pow(2, attempt) * BASE_DELAY_MS;
      const jitter = Math.random() * 1000;
      const delay = Math.min(exponentialDelay + jitter, MAX_DELAY_MS);

      console.warn(`⚠️ API Error ${error.status || ''}. Retrying in ${Math.round(delay)}ms...`);
      await sleep(delay);
    }
  }
}

// ==========================================
// 4. PLUGINS
// ==========================================

function geminiTranslatePlugin() {
  return async (tree) => {
    const nodesToTranslate = [];

    // --- PHASE 1: COLLECTION ---
    visit(tree, (node) => {
      // Skip protected blocks
      if (['code', 'inlineCode', 'mdxjsEsm', 'mdxFlowExpression'].includes(node.type)) return 'skip';

      // Text
      if (node.type === 'text' && node.value.trim()) {
        nodesToTranslate.push({ node, original: node.value, type: 'text' });
      }

      // JSX Attributes
      if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.attributes) {
        node.attributes.forEach(attr => {
          if (attr.type === 'mdxJsxAttribute' && JSX_PROPS.includes(attr.name) && typeof attr.value === 'string') {
            nodesToTranslate.push({ node: attr, original: attr.value, type: 'attribute' });
          }
        });
      }

      // Frontmatter
      if (node.type === 'yaml') {
        try {
          const frontmatter = yaml.load(node.value);
          Object.keys(frontmatter).forEach(key => {
            if (FRONTMATTER_KEYS.includes(key) && frontmatter[key]) {
              nodesToTranslate.push({ node, key, original: frontmatter[key], type: 'frontmatter', objRef: frontmatter });
            }
          });
        } catch (e) { console.error("YAML Error", e); }
      }
    });

    console.log(`Found ${nodesToTranslate.length} items to translate.`);

    // --- PHASE 2: BATCH EXECUTION ---
    const translationPromises = nodesToTranslate.map(async (item, index) => {
      // Stagger initial requests to avoid instant 429
      await sleep(index * 100); 
      
      const translatedText = await translateTextWithGemini(item.original);
      
      if (item.type === 'text') item.node.value = translatedText;
      else if (item.type === 'attribute') item.node.value = translatedText;
      else if (item.type === 'frontmatter') item.objRef[item.key] = translatedText;
    });

    await Promise.all(translationPromises);

    // --- PHASE 3: FINALIZATION ---
    visit(tree, 'yaml', (node) => {
      const linkedItem = nodesToTranslate.find(i => i.type === 'frontmatter' && i.node === node);
      if (linkedItem) {
        node.value = yaml.dump(linkedItem.objRef, { lineWidth: -1 }).trim();
      }
    });
  };
}

// ==========================================
// 5. MAIN RUNNER
// ==========================================

async function translateFile(filePath) {
  if (!process.env.GEMINI_API_KEY) {
    console.error("❌ Error: GEMINI_API_KEY is missing.");
    process.exit(1);
  }

  try {
    const file = await read(filePath);
    console.log(`📖 Reading ${filePath}...`);

    const processedFile = await unified()
      .use(remarkParse)
      .use(remarkFrontmatter, ['yaml'])
      .use(remarkDirective)
      .use(remarkMdx)
      .use(geminiTranslatePlugin)
      .use(remarkStringify, { emphasis: '*', bullet: '-', fences: true })
      .process(file);

    const outputName = filePath.replace('.mdx', '.es.mdx');
    fs.writeFileSync(outputName, String(processedFile));
    
    console.log(reporter(processedFile));
    console.log(`✅ Done! Saved to: ${outputName}`);

  } catch (error) {
    console.error('❌ detailed error:', error);
  }
}

const fileName = process.argv[2];
if (!fileName) console.log('Usage: node translator-final.js <filename.mdx>');
else translateFile(fileName);
