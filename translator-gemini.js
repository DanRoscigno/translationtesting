import fs from 'fs';
import path from 'path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
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
// 1. CONFIGURATION & ARGS
// ==========================================

// Get Args
const fileName = process.argv[2];
const langCode = process.argv[3]; // e.g., 'zh', 'ja', 'en'

if (!fileName || !langCode) {
  console.log('Usage: node translator.js <filename.mdx> <lang_code>');
  console.log('Example: node translator.js doc.mdx zh');
  process.exit(1);
}

// Language Map
const LANGUAGE_CONFIG = {
  zh: {
    name: "Simplified Chinese",
    dict: "./language_dicts/zh.yaml",
    ext: ".zh.mdx"
  },
  ja: {
    name: "Japanese",
    dict: "./language_dicts/ja.yaml",
    ext: ".ja.mdx"
  },
  en: {
    name: "English",
    dict: "./language_dicts/en.yaml", // Optional
    ext: ".en.mdx"
  }
};

const currentConfig = LANGUAGE_CONFIG[langCode];

if (!currentConfig) {
  console.error(`❌ Error: Unsupported language code '${langCode}'. Supported: zh, ja, en`);
  process.exit(1);
}

const TARGET_LANG = currentConfig.name;
const DICT_PATH = currentConfig.dict;
const FORBIDDEN_PATH = './config/never_translate.yaml'; 

// MDX Config
const FRONTMATTER_KEYS = ['title', 'description', 'sidebar_label', 'summary'];
const JSX_PROPS = ['title', 'label', 'alt', 'placeholder', 'summary'];

// API Config
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;
// Using the Reasoning Model for better instruction following
const MODEL_NAME = "gemini-2.5-pro"; 

if (!process.env.GEMINI_API_KEY) {
  console.error("❌ Error: GEMINI_API_KEY is missing.");
  process.exit(1);
}

// ==========================================
// 2. SYSTEM PROMPT CONSTRUCTION
// ==========================================

function loadConfig() {
  try {
    // 1. Load Dictionary
    let dictString = "No specific dictionary rules.";
    if (fs.existsSync(DICT_PATH)) {
      const dictYaml = yaml.load(fs.readFileSync(DICT_PATH, 'utf8'));
      dictString = Object.entries(dictYaml)
        .map(([key, val]) => `- ${key} -> ${val}`)
        .join('\n');
      console.log(`📚 Loaded dictionary: ${DICT_PATH}`);
    } else {
      console.warn(`⚠️ Dictionary not found at ${DICT_PATH}, proceeding without it.`);
    }

    // 2. Load Forbidden Terms
    let forbiddenString = "No forbidden terms.";
    if (fs.existsSync(FORBIDDEN_PATH)) {
      const forbiddenYaml = yaml.load(fs.readFileSync(FORBIDDEN_PATH, 'utf8'));
      forbiddenString = forbiddenYaml.map(term => `- ${term}`).join('\n');
      console.log(`🚫 Loaded forbidden terms: ${FORBIDDEN_PATH}`);
    }

    return { dictString, forbiddenString };
  } catch (e) {
    console.error("❌ Error loading config YAMLs:", e);
    process.exit(1);
  }
}

const { dictString, forbiddenString } = loadConfig();

// --- UPDATED POSITIVE-ONLY PROMPT ---
const SYSTEM_INSTRUCTION = `
You are a professional technical translator for StarRocks.
Your target language is ${TARGET_LANG}.

### DICTIONARY
${dictString}

### FORBIDDEN TERMS
${forbiddenString}

### TRANSLATION PATTERNS (CRITICAL)
Follow these patterns exactly to handle mixed code and text:

1. **Suffix Definitions:**
   - **Context:** Lists where a code value is followed by a description in parentheses.
   - **Source:** Supported suffixes: \`d\` (day), \`h\` (hour).
   - **Target:** 支持的后缀：\`d\`（天），\`h\`（小时）。
   - **Rule:** You MUST translate the description inside the parentheses.

2. **Mixed Code & Text:**
   - **Context:** Sentences containing variable names in backticks.
   - **Source:** Specifies the retention period (written to \`internal_log_dir\`).
   - **Target:** 指定保留期限（写入到 \`internal_log_dir\`）。
   - **Rule:** Keep the code in backticks exactly as is, but translate the surrounding text.

### CORE INSTRUCTION
**TRANSLATE EVERYTHING.** Do not stop mid-sentence. If you are unsure about a specific technical term, keep it in English, but FINISH THE SENTENCE structure.
`;

// Initialize API with System Instruction
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: MODEL_NAME,
  systemInstruction: SYSTEM_INSTRUCTION,
  generationConfig: {
    temperature: 0.3, 
    topP: 0.95,       // High topP to prevent truncation
    topK: 40,
    maxOutputTokens: 8192,
  }
});

console.log(`🚀 Initializing ${MODEL_NAME} for target: ${TARGET_LANG}`);

// ==========================================
// 3. TRANSLATION LOGIC
// ==========================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function translateTextWithGemini(text) {
  if (!text || !text.trim()) return text;

  // Cache check
  const cacheKey = `${langCode}:${text}`;
  if (global.translationCache && global.translationCache[cacheKey]) {
    return global.translationCache[cacheKey];
  }

  const userPrompt = `Translate the following text to ${TARGET_LANG}. Return ONLY the translation.
  
  Text: "${text}"`;

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const result = await model.generateContent(userPrompt);
      const response = await result.response;
      let translation = response.text().trim().replace(/^"|"$/g, '');
      
      // Basic Safety: Remove added backticks if original didn't have them
      if (!text.startsWith('`') && translation.startsWith('`') && translation.endsWith('`')) {
        translation = translation.slice(1, -1);
      }
      
      global.translationCache = global.translationCache || {};
      global.translationCache[cacheKey] = translation;
      
      return translation;

    } catch (error) {
      attempt++;
      
      if (error.status === 400 || error.status === 401 || error.status === 404) return text; 

      const isRetryable = error.status === 429 || error.status === 503 || error.status === 500;
      if (!isRetryable) return text; 
      if (attempt >= MAX_RETRIES) return text; 

      const delay = Math.min(Math.pow(2, attempt) * BASE_DELAY_MS + (Math.random() * 1000), MAX_DELAY_MS);
      await sleep(delay);
    }
  }
}

// ==========================================
// 4. PLUGINS
// ==========================================

/**
 * 1. Janitor Plugin: Cleans up formatting artifacts (Quotes, Spacing, Parentheses)
 */
function cleanupGeminiArtifactsPlugin() {
  return (tree) => {
    visit(tree, 'text', (node) => {
      if (!node.value) return;

      let text = node.value;

      // 1. Unescape backticks (Fixes `\_` and `\` issues)
      text = text.replace(/\\`/g, '`');
      text = text.replace(/\\_/g, '_'); 

      // 2. Strip Quotes around code
      // Matches: " `code` " -> `code`
      text = text.replace(/["“”]\s*(`[^`]+`)\s*["“”]/g, '$1');
      // Matches: `code` " -> `code` (Trailing quote fix)
      text = text.replace(/(`[^`]+`)\s*["“”]/g, '$1');
      // Matches: " `code` -> `code` (Leading quote fix)
      text = text.replace(/["“”]\s*(`[^`]+`)/g, '$1');

      // 3. Fix Mixed Parentheses: （ English ) -> （ English ）
      // Finds (Chinese Open + Content + English Close) and fixes it
      text = text.replace(/（([^）]*?)\)/g, '（$1）');

      // 4. Force CJK Spacing (The "Holy Grail" regex)
      // Adds space between Chinese/Japanese and English/Numbers/Code
      // Chinese -> English/Code
      text = text.replace(/([\u4e00-\u9fa5\u3040-\u30ff])([a-zA-Z0-9`])/g, '$1 $2');
      // English/Code -> Chinese
      text = text.replace(/([a-zA-Z0-9`])([\u4e00-\u9fa5\u3040-\u30ff])/g, '$1 $2');

      // 5. Final Polish: Remove double spaces created by regexes
      text = text.replace(/  +/g, ' ');

      node.value = text;
    });
  };
}

/**
 * 2. Variable Protection Plugin: Prevents snake_case escaping
 */
function protectVariablesPlugin() {
  return (tree) => {
    visit(tree, 'text', (node) => {
      // Protect snake_case_variables from being escaped
      const isSnakeCaseVariable = /^[a-zA-Z0-9]+(_[a-zA-Z0-9]+)+$/.test(node.value);
      if (isSnakeCaseVariable) {
        node.type = 'html'; 
      }
    });
  };
}

function geminiTranslatePlugin() {
  return async (tree) => {
    const nodesToTranslate = [];

    visit(tree, (node) => {
      if (['code', 'inlineCode', 'mdxjsEsm', 'mdxFlowExpression', 'html'].includes(node.type)) return 'skip';

      if (node.type === 'text' && node.value.trim()) {
        nodesToTranslate.push({ node, original: node.value, type: 'text' });
      }

      if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.attributes) {
        node.attributes.forEach(attr => {
          if (attr.type === 'mdxJsxAttribute' && JSX_PROPS.includes(attr.name) && typeof attr.value === 'string') {
            nodesToTranslate.push({ node: attr, original: attr.value, type: 'attribute' });
          }
        });
      }

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

    const bar = new cliProgress.SingleBar({
        format: 'Translate |' + colors.cyan('{bar}') + '| {percentage}% || {value}/{total} || ETA: {eta}s',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
    });

    bar.start(nodesToTranslate.length, 0);

    // BATCH PROCESSING
    const BATCH_SIZE = 10; 
    for (let i = 0; i < nodesToTranslate.length; i += BATCH_SIZE) {
        const batch = nodesToTranslate.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (item) => {
            const translatedText = await translateTextWithGemini(item.original);
            if (item.type === 'text') item.node.value = translatedText;
            else if (item.type === 'attribute') item.node.value = translatedText;
            else if (item.type === 'frontmatter') item.objRef[item.key] = translatedText;
            bar.increment();
        }));
    }

    bar.stop();
    console.log('\n'); 

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
      .use(remarkGfm)
      .use(remarkFrontmatter, ['yaml'])
      .use(remarkDirective)
      .use(remarkMdx)
      .use(geminiTranslatePlugin)
      // --- CLEANUP & PROTECTION ---
      .use(cleanupGeminiArtifactsPlugin) // 1. Clean garbage
      .use(protectVariablesPlugin)       // 2. Protect variables
      // ----------------------------
      .use(remarkStringify, { 
        emphasis: '*',
        strong: '*',
        bullet: '-',
        fences: true,
        unsafe: [
          { char: '_', inConstruct: 'phrasing', safe: true },
          { char: '<', inConstruct: 'phrasing', safe: true },
          { char: '>', inConstruct: 'phrasing', safe: true } 
        ]
      })
      .process(file);

    const outputName = filePath.replace('.mdx', currentConfig.ext);
    fs.writeFileSync(outputName, String(processedFile));
    
    console.log(reporter(processedFile));
    console.log(`✅ Done! Saved to: ${outputName}`);

  } catch (error) {
    console.error('❌ detailed error:', error);
  }
}

translateFile(fileName);
