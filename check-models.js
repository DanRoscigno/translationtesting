// check-models.js
import https from 'https';

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error("❌ Error: GEMINI_API_KEY is missing.");
  process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

console.log(`🔍 Querying: ${url.replace(API_KEY, 'HIDDEN_KEY')} ...\n`);

https.get(url, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      
      if (response.error) {
        console.error("❌ API returned an error:");
        console.error(JSON.stringify(response.error, null, 2));
        return;
      }

      if (!response.models) {
        console.log("⚠️ No models found. Your API key might be invalid or has no access.");
        return;
      }

      console.log("✅ AVAILABLE MODELS FOR YOUR KEY:");
      console.log("=================================");

      // Filter and print only models that support content generation
      const generativeModels = response.models.filter(m => 
        m.supportedGenerationMethods.includes("generateContent")
      );

      generativeModels.forEach(model => {
        console.log(`Name: ${model.name}`); // This is the string you need!
        console.log(`Desc: ${model.displayName}`);
        console.log(`---------------------------------`);
      });

      if (generativeModels.length === 0) {
        console.log("❌ No text-generation models found. You might only have access to embedding models.");
      } else {
        console.log(`\n💡 TIP: Copy one of the 'Name' strings above (e.g. 'gemini-1.5-flash') into your translator script.`);
        console.log(`   Note: You may need to remove the 'models/' prefix in the SDK, or keep it depending on the version.`);
      }

    } catch (e) {
      console.error("Error parsing JSON:", e.message);
    }
  });

}).on('error', (err) => {
  console.error("Network Error:", err.message);
});

