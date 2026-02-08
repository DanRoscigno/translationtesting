import fs from 'fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm'; // Standard Github Flavored Markdown
import remarkFrontmatter from 'remark-frontmatter';
import remarkDirective from 'remark-directive';
import remarkStringify from 'remark-stringify';
import { visit } from 'unist-util-visit';
import yaml from 'js-yaml';
import { read } from 'to-vfile';
import { reporter } from 'vfile-reporter';
import { GoogleGenerativeAI } from '@google/generative-ai';
import cliProgress from 'cli-progress';
import colors from 'colors';

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
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ Error: GEMINI_API_KEY is missing.");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Using 2.0 Flash as it is fast and smart
const MODEL_NAME = "gemini-2.0-flash"; 
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

console.log(`🚀 Initializing with model: ${MODEL_NAME}`);

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// 3. TRANSLATION LOGIC
// ==========================================

async function translateTextWithGemini(text) {
  if (!text || !text.trim()) return text;

  // Simple in-memory cache
  if (global.translationCache && global.translationCache[text]) {
    return global.translationCache[text];
  }

  // Strict prompt to prevent "Helpful" additions like backticks
  const prompt = `Translate the following technical documentation text into ${TARGET_LANG}. 
  
  RULES:
  1. Do NOT add explanations, quotes, or conversational filler. 
  2. Do NOT add new Markdown formatting (like bold, italic, or backticks) if it was not in the original text.
  3. Maintain all existing Markdown syntax, variables, and formatting exactly.
  
  Text: "${text}"
  Translation:`;

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      let translation = response.text().trim().replace(/^"|"$/g, '');
      
      // Safety Check: Remove "helpful" backticks added by Gemini if original didn't have them
      if (!text.startsWith('`') && translation.startsWith('`') && translation.endsWith('`')) {
        translation = translation.slice(1, -1);
      }
      
      // Cache success
      global.translationCache = global.translationCache || {};
      global.translationCache[text] = translation;
      
      return translation;

    } catch (error) {
      attempt++;
      
      // Fatal Errors
      if (error.status === 400 || error.status === 401 || error.status === 404) return text; 

      const isRetryable = 
        error.status === 429 || 
        error.status === 503 || 
        error.status === 500 || 
        error.message.includes("RESOURCE_EXHAUSTED") || 
        error.message.includes("Overloaded");

      if (!isRetryable) return text; 
      if (attempt >= MAX_RETRIES) return text; 

      const exponentialDelay = Math.pow(2, attempt) * BASE_DELAY_MS;
      const jitter = Math.random() * 1000;
      const delay = Math.min(exponentialDelay + jitter, MAX_DELAY_MS);

      await sleep(delay);
    }
  }
}

// ==========================================
// 4. PLUGINS
// ==========================================

/**
 * 1. Variable Protection Plugin
 * Converts snake_case_variables to raw nodes so they are NOT escaped.
 */
function protectVariablesPlugin() {
  return (tree) => {
    visit(tree, 'text', (node) => {
      // Matches strings like "sys_log_enable" or "my_var_1"
      // Must start with alphanumeric, contain underscore, end with alphanumeric
      const isSnakeCaseVariable = /^[a-zA-Z0-9]+(_[a-zA-Z0-9]+)+$/.test(node.value);
      
      if (isSnakeCaseVariable) {
        // 'html' nodes are printed raw by remark-stringify
        node.type = 'html'; 
      }
    });
  };
}

/**
 * 2. Main Translation Plugin
 */
function geminiTranslatePlugin() {
  return async (tree) => {
    const nodesToTranslate = [];

    // --- PHASE 1: COLLECTION ---
    visit(tree, (node) => {
      // Skip protected blocks
      if (['code', 'inlineCode', 'mdxjsEsm', 'mdxFlowExpression', 'html'].includes(node.type)) return 'skip';

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
        } catch (e) { }
      }
    });

    console.log(`Found ${nodesToTranslate.length} items to translate.`);

    // --- PHASE 2: BATCH EXECUTION ---
    const bar = new cliProgress.SingleBar({
        format: 'Translate |' + colors.cyan('{bar}') + '| {percentage}% || {value}/{total} || ETA: {eta}s',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
    });

    bar.start(nodesToTranslate.length, 0);

    const translationPromises = nodesToTranslate.map(async (item, index) => {
      await sleep(index * 20); // Stagger requests
      
      const translatedText = await translateTextWithGemini(item.original);
      
      if (item.type === 'text') item.node.value = translatedText;
      else if (item.type === 'attribute') item.node.value = translatedText;
      else if (item.type === 'frontmatter') item.objRef[item.key] = translatedText;

      bar.increment();
    });

    await Promise.all(translationPromises);
    bar.stop();
    console.log('\n'); 

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
  try {
    const file = await read(filePath);
    console.log(`📖 Reading ${filePath}...`);

    const processedFile = await unified()
      .use(remarkParse)
      .use(remarkGfm)                    // Support Tables/Strikethrough
      .use(remarkFrontmatter, ['yaml'])  // Support --- Frontmatter ---
      .use(remarkDirective)              // Support ::: Admonitions :::
      .use(remarkMdx)                    // Support <JSX />
      .use(geminiTranslatePlugin)        // <--- The Translation Logic
      .use(protectVariablesPlugin)       // <--- The Anti-Slash Logic
      .use(remarkStringify, { 
        emphasis: '*',                   // Cleanest formatting
        strong: '*',
        bullet: '-',
        fences: true 
      })
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
