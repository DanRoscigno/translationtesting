import fs from 'fs';
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

const fileName = process.argv[2];
const langCode = process.argv[3]; 

if (!fileName || !langCode) {
  console.log('Usage: node translator-gemini.js <filename.mdx> <lang_code>');
  console.log('Example: node translator-gemini.js doc.mdx zh');
  process.exit(1);
}

const LANG_MAP = {
  'zh': 'Simplified Chinese',
  'ja': 'Japanese',
  'en': 'English'
};

const TARGET_LANG = LANG_MAP[langCode];
if (!TARGET_LANG) {
  console.error(`❌ Error: Unsupported language code '${langCode}'. Use zh, ja, or en.`);
  process.exit(1);
}

const FRONTMATTER_KEYS = ['title', 'description', 'sidebar_label', 'summary'];
const JSX_PROPS = ['title', 'label', 'alt', 'placeholder'];

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;

if (!process.env.GEMINI_API_KEY) {
  console.error("❌ Error: GEMINI_API_KEY is missing.");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-2.5-pro"; 
const model = genAI.getGenerativeModel({ 
  model: MODEL_NAME,
  generationConfig: {
    temperature: 0.3,
    topP: 0.95, 
    topK: 40,
    maxOutputTokens: 8192,
  }
});

console.log(`🚀 Initializing with model: ${MODEL_NAME} for ${TARGET_LANG}`);

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// 3. TRANSLATION LOGIC
// ==========================================

async function translateTextWithGemini(text) {
  if (!text || !text.trim()) return text;

  if (global.translationCache && global.translationCache[text]) {
    return global.translationCache[text];
  }

  const prompt = `Translate the following technical documentation text into ${TARGET_LANG}. 
  
  RULES:
  1. Do NOT add explanations, quotes, or conversational filler. 
  2. Do NOT add new Markdown formatting (like bold, italic, or backticks) if it was not in the original text.
  3. Maintain all existing Markdown syntax, variables, and formatting exactly.
  4. If you see code like \`d\` (day), translate the text in parentheses: \`d\`（天）.
  
  Text: "${text}"
  Translation:`;

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      let translation = response.text().trim().replace(/^"|"$/g, '');
      
      if (!text.startsWith('`') && translation.startsWith('`') && translation.endsWith('`')) {
        translation = translation.slice(1, -1);
      }
      
      if (!translation || translation.trim() === '') return text;

      global.translationCache = global.translationCache || {};
      global.translationCache[text] = translation;
      
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
 * GLOBAL SNAKE CASE PROTECTOR
 * Scans ALL text nodes. If it finds a snake_case word, it converts it to inlineCode.
 * This prevents translation AND enforces backticks.
 */
function snakeCaseToCodePlugin() {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      // Regex: strictly snake_case (letters/nums, underscore, letters/nums)
      const regex = /\b[a-zA-Z0-9]+(_[a-zA-Z0-9]+)+\b/g;
      
      if (!regex.test(node.value)) return;

      const parts = [];
      let lastIndex = 0;
      let match;

      regex.lastIndex = 0;
      while ((match = regex.exec(node.value)) !== null) {
        if (match.index > lastIndex) {
          parts.push({ type: 'text', value: node.value.slice(lastIndex, match.index) });
        }
        parts.push({ type: 'inlineCode', value: match[0] });
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < node.value.length) {
        parts.push({ type: 'text', value: node.value.slice(lastIndex) });
      }

      parent.children.splice(index, 1, ...parts);
      return index + parts.length;
    });
  };
}

/**
 * UNIVERSAL JANITOR PLUGIN (CONTEXT AWARE)
 * Clean up formatting artifacts, considering sibling nodes for context.
 */
/**
 * UNIVERSAL JANITOR PLUGIN (CONTEXT AWARE)
 * Clean up formatting artifacts, considering sibling nodes for context.
 */
function cleanupGeminiArtifactsPlugin(options = { lang: 'zh' }) {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!node.value) return;
      let text = node.value;
      const lang = options.lang;

      // 1. Unescape Backticks & Fix Glued Code
      // Fixes: \`code\` -> `code`
      text = text.replace(/\\`/g, '`'); 
      // Fixes: `code``code` -> `code` `code`
      text = text.replace(/`\s*`/g, '` `');   

      // 2. Context Aware Quote Stripping
      if (parent && parent.children) {
        const prev = index > 0 ? parent.children[index - 1] : null;
        const next = index < parent.children.length - 1 ? parent.children[index + 1] : null;

        // Strip Trailing Quote if Next is Code: ...”`code`
        if (next && next.type === 'inlineCode') {
          text = text.replace(/["“”]\s*$/, ''); 
        }
        // Strip Leading Quote if Prev is Code: `code`”...
        if (prev && prev.type === 'inlineCode') {
          text = text.replace(/^\s*["“”]/, '');
        }
      }

      // Standard Quote Cleanup (within single text node)
      // Fixes: ”`d` -> `d` (Added ” to the regex)
      text = text.replace(/["“”]\s*(`[^`]+`)/g, '$1'); 
      text = text.replace(/(`[^`]+`)\s*["“”]/g, '$1'); 

      if (lang === 'zh' || lang === 'ja') {
        const cjkRegex = lang === 'zh' ? /[\u4e00-\u9fa5]/ : /[\u4e00-\u9fa5\u3040-\u30ff]/; 

        // 3. Fix Mixed Parentheses (Aggressive)
        // Trigger if contains CJK OR Numbers (Fixes "(7 days)")
        const contentPattern = `(?:${cjkRegex.source}|[0-9])`; 
        const parenRegex = new RegExp(`\\(([^)]*?${contentPattern}+[^)]*?)\\)`, 'g');
        
        text = text.replace(parenRegex, '（$1）'); 
        text = text.replace(/（([^）]*?)\)/g, '（$1）');
        text = text.replace(/\(([^)]*?)\）/g, '（$1）');

        // 4. Fix Orphan Parentheses (Context Aware)
        if (parent && parent.children) {
          const prev = index > 0 ? parent.children[index - 1] : null;
          const next = index < parent.children.length - 1 ? parent.children[index + 1] : null;

          if (text.startsWith(')') && prev && prev.type === 'inlineCode') {
              text = text.replace(/^\)/, '）');
          }
          if (text.endsWith('(') && next && next.type === 'inlineCode') {
              text = text.replace(/\($/, '（');
          }
          
          // 5. Fix XML Spacing (Context Aware)
          if (prev && (prev.type === 'html' || prev.type === 'mdxJsxFlowElement' || prev.type === 'inlineCode')) {
             if (/^[a-zA-Z0-9\u4e00-\u9fa5]/.test(text)) {
                text = ' ' + text;
             }
          }
        }

        // Standard in-text replacement for XML
        text = text.replace(/>([a-zA-Z0-9\u4e00-\u9fa5])/g, '> $1');

        // 6. Fix CJK Spacing
        text = text.replace(/([\u4e00-\u9fa5\u3040-\u30ff])([a-zA-Z0-9`])/g, '$1 $2');
        text = text.replace(/([a-zA-Z0-9`])([\u4e00-\u9fa5\u3040-\u30ff])/g, '$1 $2');

        // 7. Fix Periods
        const periodRegex = new RegExp(`(${cjkRegex.source})\\.`, 'g');
        text = text.replace(periodRegex, '$1。');
      }

      if (lang === 'en') {
        text = text.replace(/（([^）]*?)）/g, '($1)');
        text = text.replace(/。/g, '. ');
        text = text.replace(/，/g, ', ');
        text = text.replace(/：/g, ': ');
      }

      text = text.replace(/  +/g, ' ');
      node.value = text;
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

    const translationPromises = nodesToTranslate.map(async (item, index) => {
      await sleep(index * 20); 
      const translatedText = await translateTextWithGemini(item.original);
      if (item.type === 'text') item.node.value = translatedText;
      else if (item.type === 'attribute') item.node.value = translatedText;
      else if (item.type === 'frontmatter') item.objRef[item.key] = translatedText;
      bar.increment();
    });

    await Promise.all(translationPromises);
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

      // --- STEP 1: PROTECT SNAKE_CASE ---
      .use(snakeCaseToCodePlugin) 
      
      // --- STEP 2: TRANSLATE ---
      .use(geminiTranslatePlugin)
      
      // --- STEP 3: CLEANUP ---
      .use(cleanupGeminiArtifactsPlugin, { lang: langCode })
      
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

    const outputName = filePath.replace('.mdx', `.${langCode}.mdx`).replace('.md', `.${langCode}.md`);
    fs.writeFileSync(outputName, String(processedFile));
    
    console.log(reporter(processedFile));
    console.log(`✅ Done! Saved to: ${outputName}`);

  } catch (error) {
    console.error('❌ detailed error:', error);
  }
}

translateFile(fileName);