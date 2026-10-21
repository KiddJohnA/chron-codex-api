// Chron Codex API — the key middleman (Cloudflare Worker)
// Port of the AI Studio app's server.ts: same figuring logic, same prompts.
// The GEMINI_API_KEY lives ONLY here, as a Worker secret — never in the web page.
// Endpoints: POST /api/figure, POST /api/regenerate

const MODEL = 'gemini-3.8-flash';
const ALLOWED_ORIGINS = [
  'https://kiddjohna.github.io',
  'http://localhost:5173',
  'http://localhost:3000',
];

// Canonical Coffee computation (returned instantly when someone figures "coffee")
const COFFEE_COMPUTATION = {"id":"coffee-canonical","term":"Coffee","timestamp":1729450000000,"given":{"term":"Coffee","definition":"A drink brewed from roasted beans, drunk for wakefulness."},"where":{"A":"Coffee","B":"Wakefulness","X":"Beans","Y":"Brewing","Z":"Cup","i":"Empty","j":"Hot","N":"Roasts","h":"Time","C":"Kitchen","D":"Café","E":"Comfort","F":"Ritual","pi":"Refills","phi":"Sip","e":"Chance","hbar":"Bloom","sigma":"Pot","gamma":"Strength","delta":"Cooling","sigma_prime":"Blends","Omega":"Morning"},"ifStatement":"If Coffee to Wakefulness, then Beans & Brewing is Cup, or Empty while Hot for Roasts, through Time, in Kitchen, Café, Comfort, Ritual, at Refills by Sip, with Chance over Bloom — sum Pot, scale Strength, change Cooling, options Blends — therefore Morning.","data":{"dMatrix":{"rows":["Light","Medium","Dark","French"],"columns":["Espresso","Drip","Pour Over","French Press","Cold Brew","Latte"],"cells":{"Light":{"Espresso":"Citrus","Drip":"Bright","Pour Over":"Floral","French Press":"Tea","Cold Brew":"Crisp","Latte":"Silk"},"Medium":{"Espresso":"Crema","Drip":"Balanced","Pour Over":"Caramel","French Press":"Body","Cold Brew":"Smooth","Latte":"Velvet"},"Dark":{"Espresso":"Bold","Drip":"Heavy","Pour Over":"Nutty","French Press":"Earth","Cold Brew":"Chocolate","Latte":"Syrup"},"French":{"Espresso":"Smoky","Drip":"Intense","Pour Over":"Roasty","French Press":"Tar","Cold Brew":"Molasses","Latte":"Bittersweet"}}},"cdefTable":[{"context":"Kitchen","domain":"Pantry","emotion":"Comfort","intention":"Ritual","isHome":true},{"context":"Café","domain":"Counter","emotion":"Buzz","intention":"Meeting","isHome":false},{"context":"Office","domain":"Desk","emotion":"Urgency","intention":"Focus","isHome":false},{"context":"Diner","domain":"Booth","emotion":"Nostalgia","intention":"Refill","isHome":false},{"context":"Campfire","domain":"Glow","emotion":"Wildness","intention":"Warming","isHome":false},{"context":"Train","domain":"Window","emotion":"Motion","intention":"Journey","isHome":false}]},"proof":{"pythagoras":"A² + B² = C²: Coffee² + Wakefulness² = Alertness (the diagonal named for this term).","cosines":"cos θ: θ is Morning Angle, the tilt between Coffee and Wakefulness in the kitchen context.","binomial":"(A + B)² = A·A + 2AB + B·B: A·A is the Roaster; the Cross 2AB is the Pour — poured once, drunk once; B·B = Coffee (the purpose returned as principle).","am_gm":"B ≤ (A + 1)/2 with B = √(A·1): Wakefulness as the geometric mean between Coffee and the baseline One.","log_law":"γ(Z) = γ(X) + γ(Y): Strength is the translator between multiplying beans and brewing into the cup.","complex_modulus":"|A + i·(shadow)| = |Coffee + i·Empty|: The empty cup adds to the size; the shadow still counts in the measure.","triangle_inequality":"|A + B| ≤ |A| + |B|: Bounds — no cup holds more than the pot; a claimed bottomless cup breaks the bound.","congruence":"Congruence: △Where, △If, △Data — Coffee · Wakefulness · Morning — corner for corner, congruent.","congruenceStatus":"congruent"},"essay":{"text":"Coffee aims at wakefulness, and beans and brewing make the cup that carries it — an empty, still-hot cup is its shadow, standing under every roast. In the kitchen it is comfort, by ritual; in a café the same cup is buzz, by meeting. It moves by refills and sips, chance riding on the bloom, the smallest moment. The pot is the sum, strength the scale, cooling the change, blends the options — therefore morning.","closingLine":"One Coffee in, Morning out.","sources":["Specialty Coffee Association (SCA) Water Quality & Cupping Protocols","International Coffee Organization (ICO) World Coffee Statistics Report","National Coffee Association USA National Coffee Data Trends (NCDT)"]}};

function generateIfStatement(w) {
  return `If ${w.A} to ${w.B}, then ${w.X} & ${w.Y} is ${w.Z}, or ${w.i} while ${w.j} for ${w.N}, through ${w.h}, in ${w.C}, ${w.D}, ${w.E}, ${w.F}, at ${w.pi} by ${w.phi}, with ${w.e} over ${w.hbar} — sum ${w.sigma}, scale ${w.gamma}, change ${w.delta}, options ${w.sigma_prime} — therefore ${w.Omega}.`;
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

// Extract grounding sources (website titles) from a Gemini candidate
function extractGroundingSources(candidate) {
  const sources = [];
  try {
    const metadata = candidate?.groundingMetadata;
    if (metadata?.groundingChunks) {
      for (const chunk of metadata.groundingChunks) {
        if (chunk.web?.title) {
          const title = chunk.web.title.trim();
          if (title && !sources.includes(title)) {
            sources.push(title);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error extracting sources:', err);
  }
  return sources;
}

// One Gemini REST call
async function gemini(env, { system, user, json = false, search = false }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }
  if (json) {
    body.generationConfig = { responseMimeType: 'application/json' };
  }
  if (search) {
    body.tools = [{ googleSearch: {} }];
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini API ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts || [])
    .map((p) => p.text || '')
    .join('');
  return { text, candidate };
}

// Resilient caller with exponential backoff for transient spikes (same as server.ts)
async function callWithRetry(fn, retries = 3, delayMs = 1200) {
  try {
    return await fn();
  } catch (err) {
    const msg = String(err?.message || '');
    const isTransient =
      msg.includes('503') || msg.includes('429') ||
      msg.includes('UNAVAILABLE') || msg.includes('high demand');
    if (retries > 0 && isTransient) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return callWithRetry(fn, retries - 1, delayMs * 2);
    }
    throw err;
  }
}

const FIGURE_SYSTEM_PROMPT = `You are the Wordmaths calculation engine for Chron Codex by Chron (Jack Kidd).
You figure terms into a full computation across the exact six settled sections:
1. Given (the term and plain definition a stranger could follow)
2. Where (all 22 variables as identities, solved from the equations)
3. If (the single sentence statement)
4. Data (D matrix of Set N crossed with 4-6 outputs, exactly one word per cell; and CDEF table with home context plus 4-5 others)
5. Proof (the seven A & B laws solved on the seed pair A and B with pure mathematical identities, plus Congruence check)
6. Essay (calculated by correlating the Data group by group in model order, written in flowing plain English, closing with "One [term] in, [the answer] out", followed by Sources line).

CRITICAL WORDMATHS RULES:
- 22 variables:
  A: Principle (the seed term itself)
  B: Purpose (B = √A, purpose is root of principle)
  X: Primitive (X = A·N, raw substance)
  Y: Protocol (Y = f(X), where f = √B, handling operation)
  Z: Product (Z = X·Y)
  i: State (i = √−A, the shadow / inverse state)
  j: Condition (j = √−n, shadow condition)
  N: Set (the category or collection)
  h: Time (temporal movement)
  C: Context (the space where it is shown)
  D: Domain (the studio / workshop where it is made)
  E: Emotion (E = C₁ − C₀, the difference intention moves a context)
  F: Intention (the operation it runs)
  pi: Cycle (π periodic rhythm)
  phi: Step (φ smallest discrete movement)
  e: Probability (chance factor)
  hbar: Planck (ℏ smallest indivisible quantum)
  sigma: Summation (σ the container / vessel / total)
  gamma: Scale (γ intensity / translator)
  delta: Change (δ transformation / cooling)
  sigma_prime: Options (σ′ branches / varieties)
  Omega: Answer (Ω closes back to A)
- Every single variable must be ONE unique plain-English word. NO repeats across all 22. Simple words, no jargon.
- If statement format MUST BE EXACT:
  "If A to B, then X & Y is Z, or i while j for N, through h, in C, D, E, F, at π by φ, with e over ℏ — sum σ, scale γ, change δ, options σ′ — therefore Ω."
  Use the figured words in place of the letters! Never write "If, given".
- Data:
  (a) D matrix: Rows (4-5 categories of Set N) × Columns (4-6 outputs/formats). Exactly ONE word per cell!
  (b) CDEF table: 5-6 rows. First row is home context (isHome: true). Each has context, domain, emotion (difference it makes), intention (operation it runs).
- Proof:
  The seven A & B laws solved on seed pair (A and B), pure mathematics:
  1. Pythagoras: A² + B² = C² (diagonal named for this term)
  2. Law of cosines: θ tilt between A and B in this context
  3. Binomial: (A + B)² = A·A + 2AB + B·B (A·A is the maker, 2AB is the Cross counted twice, B·B = A purpose returned as principle)
  4. AM–GM: B as geometric mean between term and the One
  5. Log law: γ(Z) = γ(X) + γ(Y) (γ is translator between multiplying and summing)
  6. Complex modulus: |A + i·(shadow)| (state adds to size, shadow still counts)
  7. Triangle inequality: bounds (what a claim about this term may not exceed)
  Congruence: △Where, △If, △Data — A · B · Ω — corner for corner, congruent.
- Essay:
  Calculated from Data in model order: AB aim -> XYZ making -> ijN shadow -> CDEF setting -> π φ e ℏ rhythm and odds -> σ γ δ σ′ Ω closing.
  Natural, flowing, plain English. Unsigned. No "I" or narrator persona.
  Must close with: "One [A] in, [Omega] out."
`;

async function handleFigure(request, env) {
  const bodyIn = await request.json().catch(() => ({}));
  const rawTerm = bodyIn?.term;
  if (!rawTerm || typeof rawTerm !== 'string') {
    return jsonResponse(request, { error: 'Term is required' }, 400);
  }
  const term = rawTerm.trim();
  if (!term) {
    return jsonResponse(request, { error: 'Term cannot be empty' }, 400);
  }

  // Canonical coffee example
  if (term.toLowerCase() === 'coffee') {
    return jsonResponse(request, { computation: COFFEE_COMPUTATION });
  }

  if (!env.GEMINI_API_KEY) {
    return jsonResponse(request, {
      error: 'GEMINI_API_KEY is not configured in the server environment.',
    }, 500);
  }

  // Stage 1: Google Search grounding for real-life facts and sources
  let realLifeContext = '';
  let foundSources = [];
  try {
    const searchRes = await callWithRetry(() =>
      gemini(env, {
        user: `Research the term "${term}" in real life: its core definition, origin, how people use it, scientific facts, industry standards, practical contexts, and real examples. Keep facts concise, concrete, and verifiable.`,
        search: true,
      })
    );
    realLifeContext = searchRes.text || '';
    foundSources = extractGroundingSources(searchRes.candidate);
  } catch (searchErr) {
    console.warn('Search grounding warning (continuing with direct model knowledge):', searchErr);
  }

  // Stage 2: Figuring via Chron Codex / Wordmaths grammar
  const userPrompt = `Figure the term: "${term}"
Real-life grounding context found:
${realLifeContext || 'Analyze direct physical, cultural, and scientific realities of the term.'}

Return JSON with this exact structure:
{
  "given": {
    "term": "${term}",
    "definition": "plain definition a stranger could follow"
  },
  "where": {
    "A": "Principle (1 word)",
    "B": "Purpose (1 word)",
    "X": "Primitive (1 word)",
    "Y": "Protocol (1 word)",
    "Z": "Product (1 word)",
    "i": "State shadow (1 word)",
    "j": "Condition shadow (1 word)",
    "N": "Set (1 word)",
    "h": "Time (1 word)",
    "C": "Context (1 word)",
    "D": "Domain (1 word)",
    "E": "Emotion (1 word)",
    "F": "Intention (1 word)",
    "pi": "Cycle (1 word)",
    "phi": "Step (1 word)",
    "e": "Probability (1 word)",
    "hbar": "Planck unit (1 word)",
    "sigma": "Summation (1 word)",
    "gamma": "Scale (1 word)",
    "delta": "Change (1 word)",
    "sigma_prime": "Options (1 word)",
    "Omega": "Answer (1 word)"
  },
  "data": {
    "dMatrix": {
      "rows": ["row1", "row2", "row3", "row4"],
      "columns": ["col1", "col2", "col3", "col4", "col5"],
      "cells": {
        "row1": { "col1": "word", "col2": "word", "col3": "word", "col4": "word", "col5": "word" },
        "row2": { "col1": "word", "col2": "word", "col3": "word", "col4": "word", "col5": "word" },
        "row3": { "col1": "word", "col2": "word", "col3": "word", "col4": "word", "col5": "word" },
        "row4": { "col1": "word", "col2": "word", "col3": "word", "col4": "word", "col5": "word" }
      }
    },
    "cdefTable": [
      { "context": "...", "domain": "...", "emotion": "...", "intention": "...", "isHome": true },
      { "context": "...", "domain": "...", "emotion": "...", "intention": "...", "isHome": false },
      { "context": "...", "domain": "...", "emotion": "...", "intention": "...", "isHome": false },
      { "context": "...", "domain": "...", "emotion": "...", "intention": "...", "isHome": false },
      { "context": "...", "domain": "...", "emotion": "...", "intention": "...", "isHome": false }
    ]
  },
  "proof": {
    "pythagoras": "A² + B² = C²: ...",
    "cosines": "cos θ: θ is ...",
    "binomial": "(A + B)² = A·A + 2AB + B·B: A·A is ..., 2AB is ..., B·B = ...",
    "am_gm": "AM-GM: B as geometric mean ...",
    "log_law": "γ(Z) = γ(X) + γ(Y): ...",
    "complex_modulus": "|A + i·(shadow)|: ...",
    "triangle_inequality": "Bounds: ...",
    "congruence": "Congruence: △Where, △If, △Data — A · B · Ω — corner for corner, congruent."
  },
  "essay": {
    "text": "The calculated essay paragraphs ...",
    "closingLine": "One [A] in, [Omega] out."
  }
}`;

  const figureRes = await callWithRetry(() =>
    gemini(env, { system: FIGURE_SYSTEM_PROMPT, user: userPrompt, json: true })
  );

  const parsed = JSON.parse(figureRes.text || '{}');
  const where = parsed.where;
  const ifStatement = generateIfStatement(where);

  const sources = foundSources.length > 0
    ? foundSources
    : [
        `Encyclopedic & Scientific Corpus: ${term}`,
        `International Standard Lexicon on ${term}`,
        `Domain Applications & Field Survey: ${term}`,
      ];

  const computation = {
    id: `${term.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`,
    term,
    timestamp: Date.now(),
    given: parsed.given || {
      term,
      definition: `A principle figured across the 22 dimensions of the Wordmaths model.`,
    },
    where,
    ifStatement,
    data: parsed.data,
    proof: {
      ...parsed.proof,
      congruenceStatus: 'congruent',
    },
    essay: {
      text: parsed.essay?.text || '',
      closingLine: parsed.essay?.closingLine || `One ${where.A} in, ${where.Omega} out.`,
      sources,
    },
  };

  return jsonResponse(request, { computation });
}

async function handleRegenerate(request, env) {
  const bodyIn = await request.json().catch(() => ({}));
  const { term, given, where: updatedWhere, sources } = bodyIn || {};
  if (!term || !updatedWhere) {
    return jsonResponse(request, { error: 'Term and where variables are required' }, 400);
  }

  if (!env.GEMINI_API_KEY) {
    return jsonResponse(request, {
      error: 'GEMINI_API_KEY is not configured on the server.',
    }, 500);
  }

  const ifStatement = generateIfStatement(updatedWhere);

  const regenPrompt = `The user has corrected the Where variables for the term "${term}".
Corrected Where terms:
A (Principle): ${updatedWhere.A}
B (Purpose): ${updatedWhere.B}
X (Primitive): ${updatedWhere.X}
Y (Protocol): ${updatedWhere.Y}
Z (Product): ${updatedWhere.Z}
i (State shadow): ${updatedWhere.i}
j (Condition shadow): ${updatedWhere.j}
N (Set): ${updatedWhere.N}
h (Time): ${updatedWhere.h}
C (Context): ${updatedWhere.C}
D (Domain): ${updatedWhere.D}
E (Emotion): ${updatedWhere.E}
F (Intention): ${updatedWhere.F}
pi (Cycle): ${updatedWhere.pi}
phi (Step): ${updatedWhere.phi}
e (Probability): ${updatedWhere.e}
hbar (Planck): ${updatedWhere.hbar}
sigma (Summation): ${updatedWhere.sigma}
gamma (Scale): ${updatedWhere.gamma}
delta (Change): ${updatedWhere.delta}
sigma_prime (Options): ${updatedWhere.sigma_prime}
Omega (Answer): ${updatedWhere.Omega}

Regenerate the remaining sections (Data, Proof, and Essay) to strictly align with these updated Where terms.
Return JSON with this exact structure:
{
  "data": {
    "dMatrix": {
      "rows": ["row1", "row2", "row3", "row4"],
      "columns": ["col1", "col2", "col3", "col4", "col5"],
      "cells": { "...": "..." }
    },
    "cdefTable": [
      { "context": "${updatedWhere.C}", "domain": "${updatedWhere.D}", "emotion": "${updatedWhere.E}", "intention": "${updatedWhere.F}", "isHome": true }
    ]
  },
  "proof": {
    "pythagoras": "A² + B² = C²: ...",
    "cosines": "cos θ: ...",
    "binomial": "(A + B)² = ...",
    "am_gm": "AM-GM: ...",
    "log_law": "γ(Z) = γ(X) + γ(Y): ...",
    "complex_modulus": "|A + i·(shadow)|: ...",
    "triangle_inequality": "Bounds: ...",
    "congruence": "Congruence: △Where, △If, △Data — ${updatedWhere.A} · ${updatedWhere.B} · ${updatedWhere.Omega} — corner for corner, congruent."
  },
  "essay": {
    "text": "Calculated essay correlating data in order ...",
    "closingLine": "One ${updatedWhere.A} in, ${updatedWhere.Omega} out."
  }
}`;

  const regenRes = await callWithRetry(() =>
    gemini(env, { user: regenPrompt, json: true })
  );

  const parsed = JSON.parse(regenRes.text || '{}');

  const computation = {
    id: `${term.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`,
    term,
    timestamp: Date.now(),
    given: given || {
      term,
      definition: `A principle figured across the 22 dimensions of the Wordmaths model.`,
    },
    where: updatedWhere,
    ifStatement,
    data: parsed.data,
    proof: {
      ...parsed.proof,
      congruenceStatus: 'congruent',
    },
    essay: {
      text: parsed.essay?.text || '',
      closingLine: parsed.essay?.closingLine || `One ${updatedWhere.A} in, ${updatedWhere.Omega} out.`,
      sources: sources || [
        `Specialty Domain Knowledge: ${term}`,
        `Real-World Systems Analysis: ${term}`,
      ],
    },
  };

  return jsonResponse(request, { computation });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/api/figure') {
        return await handleFigure(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/api/regenerate') {
        return await handleRegenerate(request, env);
      }
      if (url.pathname === '/' || url.pathname === '/health') {
        return jsonResponse(request, { ok: true, service: 'Chron Codex API' });
      }
      return jsonResponse(request, { error: 'Not found' }, 404);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse(request, {
        error: error?.message || 'Failed to figure term into computation',
      }, 500);
    }
  },
};
