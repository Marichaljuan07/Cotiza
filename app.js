
"use strict";

const APP_VERSION = "4.3.2";

const DEFAULT_RULES = {
  version: "4.0.0",
  locale: "es-UY",
  currency: { code: "UYU", symbol: "$" },

  jobs: [
    {
      id: "cambio_cerradura",
      title: "Cambio de cerradura",
      keywords: [
        "cambio de cerradura",
        "cambiar cerradura",
        "cambiar la cerradura",
        "reemplazar cerradura",
        "cerradura",
        "cerrojo"
      ],
      actionText: "retirar la cerradura existente, instalar la nueva cerradura, hacer los ajustes necesarios y comprobar que quede funcionando correctamente"
    },
    {
      id: "pintura",
      title: "Trabajo de pintura",
      keywords: ["pintar","pintura","pintado","pintura interior","pintura exterior"],
      actionText: "realizar la preparación necesaria y el trabajo de pintura acordado"
    },
    {
      id: "electricidad",
      title: "Trabajo eléctrico",
      keywords: ["electricidad","eléctrico","electrico","enchufe","tomacorriente","llave de luz","luminaria","cableado"],
      actionText: "realizar el trabajo eléctrico indicado y comprobar que la instalación quede funcionando correctamente"
    },
    {
      id: "sanitaria",
      title: "Trabajo de sanitaria",
      keywords: ["sanitaria","canilla","grifo","caño","cano","cisterna","pérdida","perdida"],
      actionText: "realizar la reparación o instalación sanitaria indicada y comprobar su funcionamiento"
    },
    {
      id: "carpinteria",
      title: "Trabajo de carpintería",
      keywords: ["carpintería","carpinteria","mueble","madera","puerta","estante","placard"],
      actionText: "realizar el trabajo de carpintería acordado, incluyendo los ajustes necesarios"
    }
  ],

  reminders: {
    defaultOffsetMinutes: 60
  }
};

let RULES = clone(DEFAULT_RULES);

const $ = id => document.getElementById(id);

const STATE = {
  draft: null,
  pendingQuestion: null,
  activeJobId: null,
  closeStatus: null
};

const REQUIRED_FIELDS = ["client", "phone", "job", "address", "price", "time"];

document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  migrateV2Data();
  await loadRules();
  bindNavigation();
  bindHome();
  bindCloseFlow();
  bindProfile();
  bindPrefs();
  updateHeaderDate();
  updateGreeting();
  loadProfileIntoForm();
  loadPaymentsIntoForm();
  loadPrefsIntoForm();
  renderProfilePreview();
  renderJobs();
  renderReminders();
  setInterval(updateHeaderDate, 60_000);
}

async function loadRules() {
  try {
    const response = await fetch("./rules.json", { cache: "no-store" });
    if (!response.ok) throw new Error("rules.json no disponible");

    const external = await response.json();
    RULES = mergeRules(DEFAULT_RULES, external);
    $("engineBadge").textContent = "Motor v4 + JSON";
  } catch {
    RULES = clone(DEFAULT_RULES);
    $("engineBadge").textContent = "Motor v4";
  }
}

function mergeRules(base, external) {
  const out = clone(base);

  if (external?.locale) out.locale = external.locale;
  if (external?.currency?.code) out.currency.code = external.currency.code;

  if (Array.isArray(external?.jobs)) {
    const converted = external.jobs.map(job => ({
      id: job.id || slugify(job.title || "trabajo"),
      title: job.title || "Trabajo",
      keywords: Array.isArray(job.keywords) ? job.keywords : [],
      actionText: job.actionText || templateToAction(job.template || job.description || "")
    }));

    out.jobs = dedupeJobs([...out.jobs, ...converted]);
  }

  return out;
}

function templateToAction(text) {
  if (!text) return "realizar el trabajo acordado";
  return String(text).replace(/\.$/, "").replace(/^Trabajo según /i, "realizar el trabajo según ");
}

function dedupeJobs(jobs) {
  const map = new Map();
  jobs.forEach(job => map.set(job.id, job));
  return [...map.values()];
}

/* ---------------- NAVEGACIÓN ---------------- */

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
      const target = button.dataset.target;

      document.querySelectorAll(".page").forEach(page => {
        page.classList.toggle("active", page.dataset.page === target);
      });

      document.querySelectorAll(".nav-item").forEach(item => {
        item.classList.toggle("active", item.dataset.target === target);
      });

      if (target === "reminders") renderReminders();
      if (target === "profile") renderProfilePreview();

      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/* ---------------- CAPTURA ---------------- */

function bindHome() {
  document.querySelectorAll("[data-example]").forEach(button => {
    button.addEventListener("click", () => {
      $("rawInput").value = button.dataset.example || "";
      $("rawInput").focus();
    });
  });

  $("interpretBtn").addEventListener("click", startInterpretation);
  $("answerBtn").addEventListener("click", answerClarification);

  $("shareDescriptionBtn").addEventListener("click", shareDescription);
  $("copyDescriptionBtn").addEventListener("click", copyDescription);
  $("saveJobBtn").addEventListener("click", saveCurrentJob);
  $("clearJobsBtn").addEventListener("click", clearJobs);

  $("editReminderBtn").addEventListener("click", () => {
    $("reminderEditor").classList.toggle("hidden");
  });

  $("reminderOffset").addEventListener("change", syncDraftFromFields);

  [
    "clientField","phoneField","addressField","neighborhoodField",
    "priceField","dateField","timeField"
  ].forEach(id => {
    $(id).addEventListener("input", () => {
      syncDraftFromFields();
      regenerateOperationalMessage();
    });

    $(id).addEventListener("change", () => {
      syncDraftFromFields();
      regenerateOperationalMessage();
    });
  });
}

function startInterpretation() {
  const raw = $("rawInput").value.trim();

  if (!raw) {
    toast("Contame primero el trabajo.");
    return;
  }

  const draft = interpretText(raw);
  STATE.draft = draft;
  STATE.pendingQuestion = null;

  if (draft.missing.length) {
    hideResult();
    askNextMissing(draft);
    return;
  }

  hideClarification();
  showResult(draft);
}

function interpretText(raw) {
  const trace = [];
  const normalized = normalize(raw);
  const prefs = getPrefs();

  const client = extractClient(raw, trace);
  const phone = extractPhone(raw, trace);
  const job = extractJob(raw, normalized, trace);
  const address = extractAddress(raw, trace);
  const neighborhood = extractNeighborhood(raw, trace);
  const price = extractPrice(raw, trace);
  const schedule = extractSchedule(raw, normalized, trace);

  let date = schedule.date || "";
  let dateOrigin = schedule.dateOrigin || "missing";

  if (!date && prefs.missingDateBehavior === "today") {
    date = toDateInput(new Date());
    dateOrigin = "inferred_today";
    trace.push({ rule: "date.inferredToday", value: date });
  }

  const draft = {
    id: makeId(),
    raw,
    client,
    phone,
    job,
    address,
    neighborhood,
    price,
    date,
    time: schedule.time || "",
    dateOrigin,
    timeOrigin: schedule.timeOrigin || "missing",
    relativeTimeText: schedule.relativeText || "",
    reminderOffset: null,
    reminderMode: "auto",
    status: "pendiente",
    payment: {
      status: "pendiente",
      finalPrice: null,
      paidAmount: 0,
      method: ""
    },
    events: [],
    trace,
    missing: []
  };

  if (!draft.job) draft.missing.push("job");
  if (!draft.client) draft.missing.push("client");
  if (!draft.phone) draft.missing.push("phone");
  if (!draft.address) draft.missing.push("address");
  if (draft.price == null) draft.missing.push("price");

  if (!draft.date && prefs.missingDateBehavior === "ask") draft.missing.push("date");
  if (!draft.time) draft.missing.push("time");

  draft.description = draft.job ? buildOperationalMessage(draft) : "";

  trace.push({
    rule: "missing.required",
    fields: [...draft.missing]
  });

  return draft;
}

/* ---------------- EXTRACCIÓN ---------------- */

function extractClient(raw, trace) {
  const patterns = [
    /\bme\s+llam[oó]\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,2})/i,
    /\bcliente\s*[:\-]?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,2})/i,
    /\bpara\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,2})/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;

    const candidate = cleanClientCandidate(match[1]);
    if (candidate) {
      trace.push({ rule: "client.pattern", source: match[0], value: candidate });
      return candidate;
    }
  }

  const leading = raw.match(/^\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})\b/);

  if (leading?.[1]) {
    const candidate = cleanClientCandidate(leading[1]);

    if (candidate && !looksLikeJobWord(candidate)) {
      trace.push({ rule: "client.leadingName", source: leading[0], value: candidate });
      return candidate;
    }
  }

  return "";
}

function cleanClientCandidate(value) {
  let candidate = String(value || "")
    .trim()
    .replace(/[.,;:]+$/g, "")
    .split(/\b(?:por|porque|que|con|sin|en|al|a\s+las|el|la|los|las)\b/i)[0]
    .trim();

  if (!candidate) return "";

  const n = normalize(candidate);

  const blocked = [
    "viernes","lunes","martes","miercoles","jueves","sabado","domingo",
    "hoy","manana","trabajo","cerradura","puerta","presupuesto","precio","total",
    "cambio","reparacion","instalacion"
  ];

  if (n.split(" ").some(word => blocked.includes(word))) return "";

  const words = candidate.split(/\s+/);
  if (words.length > 3) return "";

  return titleCaseName(candidate);
}

function extractPhone(raw, trace) {
  const matches = [...raw.matchAll(/(?:\+598[\s-]?)?(0?9\d)(?:[\s.-]?)(\d{3})(?:[\s.-]?)(\d{3})\b/g)];

  if (!matches.length) return "";

  const m = matches[0];
  const prefix = m[1].startsWith("0") ? m[1] : `0${m[1]}`;
  const phone = `${prefix} ${m[2]} ${m[3]}`;

  trace.push({ rule: "phone.uyMobile", source: m[0], value: phone });
  return phone;
}

function extractJob(raw, normalized, trace) {
  let best = null;

  for (const job of RULES.jobs) {
    const hits = (job.keywords || [])
      .filter(keyword => normalized.includes(normalize(keyword)))
      .sort((a, b) => b.length - a.length);

    if (!hits.length) continue;

    const score = hits.reduce((sum, keyword) => sum + normalize(keyword).length, 0);

    if (!best || score > best.score) best = { job, hits, score };
  }

  if (best) {
    trace.push({
      rule: "job.keywords",
      value: best.job.id,
      keywords: best.hits
    });

    return best.job;
  }

  // Fallback genérico: intentamos conservar una frase corta alrededor de verbos de acción.
  const generic = extractGenericJob(raw);

  if (generic) {
    const job = {
      id: `manual_${slugify(generic)}`,
      title: capitalize(generic),
      keywords: [],
      actionText: `realizar ${generic.toLowerCase()} según lo acordado`
    };

    trace.push({ rule: "job.generic", value: generic });
    return job;
  }

  trace.push({ rule: "job.none" });
  return null;
}

function extractGenericJob(raw) {
  const patterns = [
    /\b(?:hay\s+que|tengo\s+que|tiene\s+que|voy\s+a|ir\s+a)\s+([^.,;]{4,70})/i,
    /\b(revisar|reparar|cortar|instalar|colocar|cambiar|arreglar|limpiar|armar|desarmar)\s+([^.,;]{2,55})/i
  ];

  for (const pattern of patterns) {
    const m = raw.match(pattern);

    if (m) {
      let phrase = m[2] ? `${m[1]} ${m[2]}` : m[1];
      phrase = phrase
        .replace(/\b(?:en|para)\s+[A-ZÁÉÍÓÚÑ]?[A-Za-zÁÉÍÓÚÑáéíóúñ .'-]*\d{2,5}.*$/i, "")
        .replace(/\$\s*\d.*$/i, "")
        .trim();

      if (phrase.length >= 4 && phrase.length <= 70) return phrase;
    }
  }

  return "";
}

function extractAddress(raw, trace) {
  const patterns = [
    /\b(?:direcci[oó]n|domicilio)\s*[:\-]?\s*([^,.;\n]{3,90}\d[^,.;\n]{0,40})/i,
    /\b(?:es|queda|trabajo|servicio)\s+en\s+([^,.;\n]{2,70}\d{2,5}(?:\s*(?:apto|apartamento|local|casa|bis|oficina)\s*[\w-]+)?)/i,
    /\ben\s+((?:av\.?|avenida|bulevar|blvr\.?|calle)?\s*[A-Za-zÁÉÍÓÚÑáéíóúñ .'-]{2,45}\s+\d{2,5}(?:\s*(?:apto|apartamento|local|casa|bis|oficina)\s*[\w-]+)?)/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;

    let address = match[1]
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\b(?:hoy|mañana|manana|el\s+(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo))\b.*$/i, "")
      .replace(/\$\s*\d.*$/i, "")
      .trim();

    if (address && /\d/.test(address)) {
      trace.push({ rule: "address.pattern", source: match[0], value: address });
      return address;
    }
  }

  return "";
}

function extractNeighborhood(raw, trace) {
  const patterns = [
    /\b(?:barrio|zona)\s*[:\-]?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ ]{3,35})/i,
    /\b(?:en|por)\s+(Pocitos|Cord[oó]n|Centro|Malv[ií]n|Buceo|Prado|Carrasco|Aguada|Palermo|Parque Rod[oó]|Tres Cruces|La Blanqueada|Goes|Jacinto Vera|Punta Carretas|Punta Gorda)\b/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      const value = titleCaseName(match[1].trim());
      trace.push({ rule: "neighborhood.pattern", source: match[0], value });
      return value;
    }
  }

  return "";
}

function extractPrice(raw, trace) {
  const finalDecision = raw.match(
    /\b(?:finalmente|al final|quedamos\s+en|cerramos\s+en|precio\s+acordado)\b[\s\S]{0,35}?\$?\s*([0-9][0-9.\s]*(?:,[0-9]{1,2})?)/i
  );

  if (finalDecision?.[1]) {
    const value = parseMoney(finalDecision[1]);

    if (value != null) {
      trace.push({ rule: "price.finalDecision", source: finalDecision[0], value });
      return value;
    }
  }

  const patterns = [
    /\$\s*([0-9][0-9.\s]*(?:,[0-9]{1,2})?)/,
    /\b([0-9][0-9.\s]*(?:,[0-9]{1,2})?)\s*(?:pesos|peso|uyu)\b/i,
    /\b(?:precio|importe|valor|sale|presupuesto)\s*[:\-]?\s*\$?\s*([0-9][0-9.\s]*(?:,[0-9]{1,2})?)/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;

    const value = parseMoney(match[1]);

    if (value != null && value > 0) {
      trace.push({ rule: "price.pattern", source: match[0], value });
      return value;
    }
  }

  return null;
}

function parseMoney(raw) {
  if (!raw) return null;

  let value = String(raw).trim().replace(/\s/g, "");

  if (value.includes(",") && value.includes(".")) {
    value = value.replace(/\./g, "").replace(",", ".");
  } else if (value.includes(",")) {
    value = value.replace(",", ".");
  } else if (value.includes(".")) {
    const parts = value.split(".");
    if (parts.at(-1).length === 3) value = value.replace(/\./g, "");
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractSchedule(raw, normalized, trace) {
  const now = new Date();

  // AHORA
  if (/\b(?:ahora|ya mismo)\b/i.test(raw)) {
    trace.push({ rule: "time.now", value: now.toISOString() });
    return {
      date: toDateInput(now),
      time: toTimeInput(now),
      dateOrigin: "text",
      timeOrigin: "relative",
      relativeText: "ahora"
    };
  }

  // "en media hora"
  if (/\b(?:en|dentro\s+de)\s+media\s+hora\b/i.test(raw)) {
    const target = new Date(now.getTime() + 30 * 60_000);

    trace.push({ rule: "time.relative", source: "media hora", value: target.toISOString() });

    return {
      date: toDateInput(target),
      time: toTimeInput(target),
      dateOrigin: "relative",
      timeOrigin: "relative",
      relativeText: "en media hora"
    };
  }

  // "en una hora y media"
  if (/\b(?:en|dentro\s+de)\s+una\s+hora\s+y\s+media\b/i.test(raw)) {
    const target = new Date(now.getTime() + 90 * 60_000);

    trace.push({ rule: "time.relative", source: "una hora y media", value: target.toISOString() });

    return {
      date: toDateInput(target),
      time: toTimeInput(target),
      dateOrigin: "relative",
      timeOrigin: "relative",
      relativeText: "en una hora y media"
    };
  }

  // "en una hora"
  if (/\b(?:en|dentro\s+de)\s+una\s+hora\b/i.test(raw)) {
    const target = new Date(now.getTime() + 60 * 60_000);

    trace.push({ rule: "time.relative", source: "una hora", value: target.toISOString() });

    return {
      date: toDateInput(target),
      time: toTimeInput(target),
      dateOrigin: "relative",
      timeOrigin: "relative",
      relativeText: "en una hora"
    };
  }

  // "en 20 minutos / 2 horas"
  const relative = raw.match(/\b(?:en|dentro\s+de)\s+(\d+)\s*(minutos?|mins?|horas?|hs?)\b/i);

  if (relative) {
    const amount = Number(relative[1]);
    const unit = normalize(relative[2]);
    const minutes = unit.startsWith("h") ? amount * 60 : amount;
    const target = new Date(now.getTime() + minutes * 60_000);

    trace.push({ rule: "time.relative", source: relative[0], value: target.toISOString() });

    return {
      date: toDateInput(target),
      time: toTimeInput(target),
      dateOrigin: "relative",
      timeOrigin: "relative",
      relativeText: relative[0]
    };
  }

  let date = "";
  let dateOrigin = "missing";

  const explicitDate = raw.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);

  if (explicitDate) {
    const day = Number(explicitDate[1]);
    const month = Number(explicitDate[2]) - 1;
    let year = explicitDate[3] ? Number(explicitDate[3]) : now.getFullYear();
    if (year < 100) year += 2000;

    const parsed = new Date(year, month, day, 12, 0, 0, 0);

    if (!Number.isNaN(parsed.getTime())) {
      date = toDateInput(parsed);
      dateOrigin = "text";
      trace.push({ rule: "date.explicit", source: explicitDate[0], value: date });
    }
  }

  if (!date) {
    if (normalized.includes("pasado manana")) {
      date = toDateInput(addDays(now, 2));
      dateOrigin = "text";
    } else if (normalized.includes("manana")) {
      date = toDateInput(addDays(now, 1));
      dateOrigin = "text";
    } else if (normalized.includes("hoy")) {
      date = toDateInput(now);
      dateOrigin = "text";
    } else {
      const weekdays = [
        ["domingo",0],["lunes",1],["martes",2],["miercoles",3],
        ["jueves",4],["viernes",5],["sabado",6]
      ];

      for (const [name, day] of weekdays) {
        if (normalized.includes(name)) {
          date = toDateInput(nextWeekday(now, day));
          dateOrigin = "text";
          trace.push({ rule: "date.weekday", source: name, value: date });
          break;
        }
      }
    }
  }

  let time = "";
  let timeOrigin = "missing";

  const timePatterns = [
    /\b(?:a\s+las?|para\s+las?)\s+(\d{1,2})(?::(\d{2}))?\s*(?:hs?|horas?)?\b/i,
    /\b(\d{1,2}):(\d{2})\b/
  ];

  for (const pattern of timePatterns) {
    const match = raw.match(pattern);
    if (!match) continue;

    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);

    // Expresiones "a las 5" se interpretan como tarde para trabajos del mismo día.
    if (pattern === timePatterns[0] && hour >= 1 && hour <= 7) hour += 12;

    if (hour <= 23 && minute <= 59) {
      time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      timeOrigin = "text";
      trace.push({ rule: "time.explicit", source: match[0], value: time });
      break;
    }
  }

  return {
    date,
    time,
    dateOrigin,
    timeOrigin,
    relativeText: ""
  };
}

/* ---------------- ACLARACIONES ---------------- */

function askNextMissing(draft) {
  const field = draft.missing[0];
  if (!field) {
    hideClarification();
    showResult(draft);
    return;
  }

  STATE.pendingQuestion = field;

  $("clarificationTitle").textContent = "Falta un dato importante";
  $("clarificationSummary").textContent = knownSummary(draft);
  $("questionLabel").textContent = questionFor(field);
  $("clarificationInput").value = "";
  $("clarificationInput").placeholder = placeholderFor(field);
  $("clarificationInput").type = field === "phone" ? "tel" : field === "price" ? "number" : field === "time" ? "time" : field === "date" ? "date" : "text";
  $("choiceArea").classList.add("hidden");

  $("clarificationPanel").classList.remove("hidden");
  $("clarificationPanel").scrollIntoView({ behavior: "smooth", block: "center" });

  setTimeout(() => $("clarificationInput").focus(), 100);
}

function answerClarification() {
  if (!STATE.draft || !STATE.pendingQuestion) return;

  const field = STATE.pendingQuestion;
  const value = $("clarificationInput").value.trim();

  if (!value) {
    toast("Ese dato es necesario para completar el trabajo.");
    return;
  }

  switch (field) {
    case "job": {
      const detected = extractJob(value, normalize(value), STATE.draft.trace);

      STATE.draft.job = detected || {
        id: `manual_${slugify(value)}`,
        title: capitalize(value),
        keywords: [],
        actionText: `realizar ${value.toLowerCase()} según lo acordado`
      };
      break;
    }

    case "client":
      STATE.draft.client = value;
      break;

    case "phone":
      STATE.draft.phone = normalizePhoneInput(value);
      break;

    case "address":
      STATE.draft.address = value;
      break;

    case "price":
      STATE.draft.price = parseMoney(value);
      break;

    case "date":
      STATE.draft.date = value;
      STATE.draft.dateOrigin = "asked";
      break;

    case "time":
      STATE.draft.time = value;
      STATE.draft.timeOrigin = "asked";
      break;
  }

  STATE.draft.trace.push({
    rule: `clarification.${field}`,
    value: field === "price" ? STATE.draft.price : STATE.draft[field]
  });

  STATE.draft.missing = STATE.draft.missing.filter(item => item !== field);
  STATE.pendingQuestion = null;

  if (STATE.draft.missing.length) {
    askNextMissing(STATE.draft);
    return;
  }

  STATE.draft.description = buildOperationalMessage(STATE.draft);
  hideClarification();
  showResult(STATE.draft);
}

function hideClarification() {
  $("clarificationPanel").classList.add("hidden");
}

function knownSummary(draft) {
  const bits = [];

  if (draft.client) bits.push(draft.client);
  if (draft.job) bits.push(draft.job.title);
  if (draft.address) bits.push(draft.address);
  if (draft.price != null) bits.push(formatMoney(draft.price));

  return bits.length
    ? `Ya tengo: ${bits.join(" · ")}.`
    : "Voy completando la ficha de a un dato por vez.";
}

function questionFor(field) {
  const map = {
    job: "¿Qué trabajo hay que hacer?",
    client: "¿Cómo se llama el cliente?",
    phone: "¿Cuál es el teléfono del cliente?",
    address: "¿Cuál es la dirección exacta del trabajo?",
    price: "¿Qué precio acordaste con el cliente?",
    date: "¿Qué día es el trabajo?",
    time: "¿A qué hora es el trabajo?"
  };

  return map[field] || "¿Qué dato falta?";
}

function placeholderFor(field) {
  const map = {
    job: "Ej.: cambio de cerradura",
    client: "Ej.: Lucía",
    phone: "Ej.: 099 123 456",
    address: "Ej.: Rivera 2345 apto 302",
    price: "Ej.: 4500",
    date: "",
    time: ""
  };

  return map[field] || "";
}

/* ---------------- MENSAJE OPERATIVO ---------------- */

function buildOperationalMessage(draft) {
  if (!draft.job) return "";

  const lines = [];

  const when = naturalWhen(draft.date, draft.time, draft.relativeTimeText);
  const location = [draft.address, draft.neighborhood].filter(Boolean).join(", ");

  let opening = `Trabajo para ${draft.client || "el cliente"}`;

  if (when) opening += ` ${when}`;
  if (location) opening += ` en ${location}`;

  opening += ".";
  lines.push(opening);

  lines.push(`${capitalize(draft.job.actionText || `realizar ${draft.job.title.toLowerCase()}`)}.`);

  if (draft.phone) {
    lines.push(`Contacto del cliente: ${draft.phone}.`);
  }

  if (draft.price != null) {
    lines.push(`Precio acordado con el cliente: ${formatMoney(draft.price)}.`);
  }

  return lines.join(" ");
}

function naturalWhen(date, time, relativeText) {
  if (!date) return "";

  const now = new Date();
  const work = time ? combineLocalDateTime(date, time) : parseLocalDate(date);
  const minutes = Math.round((work - now) / 60_000);

  let absolute;

  if (date === toDateInput(now)) {
    absolute = time ? `hoy a las ${time}` : "hoy";
  } else if (date === toDateInput(addDays(now, 1))) {
    absolute = time ? `mañana a las ${time}` : "mañana";
  } else {
    const day = new Intl.DateTimeFormat("es-UY", {
      weekday: "long",
      day: "numeric",
      month: "long"
    }).format(parseLocalDate(date));

    absolute = time ? `el ${day} a las ${time}` : `el ${day}`;
  }

  if (!time) return absolute;

  if (minutes >= 0 && minutes <= 10) return `${absolute} — es prácticamente ahora`;
  if (minutes > 10 && minutes <= 35) return `${absolute} — dentro de aproximadamente ${minutes} minutos`;
  if (minutes > 35 && minutes <= 95) return `${absolute} — dentro de aproximadamente ${humanDuration(minutes)}`;

  return absolute;
}

function regenerateOperationalMessage() {
  if (!STATE.draft?.job) return;

  syncDraftFromFields();

  STATE.draft.description = buildOperationalMessage(STATE.draft);
  $("descriptionField").value = STATE.draft.description;
}

/* ---------------- RESULTADO / RECORDATORIO ---------------- */

function showResult(draft) {
  draft.description = buildOperationalMessage(draft);

  $("resultJobTitle").textContent = draft.job?.title || "Trabajo";
  $("descriptionField").value = draft.description || "";
  requestAnimationFrame(() => autoGrowTextarea($("descriptionField")));
  $("clientField").value = draft.client || "";
  $("phoneField").value = draft.phone || "";
  $("addressField").value = draft.address || "";
  $("neighborhoodField").value = draft.neighborhood || "";
  $("priceField").value = draft.price ?? "";
  $("dateField").value = draft.date || "";
  $("timeField").value = draft.time || "";
  $("traceOutput").textContent = JSON.stringify(draft.trace, null, 2);

  renderInferenceNotice(draft);

  const autoReminder = computeSmartReminder(draft);
  draft.reminderOffset = autoReminder.offset;
  draft.reminderMode = "auto";
  $("reminderOffset").value = String(autoReminder.offset);

  $("resultPanel").classList.remove("hidden");
  updateReminderPreview(autoReminder.reason);

  $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function hideResult() {
  $("resultPanel").classList.add("hidden");
}

function renderInferenceNotice(draft) {
  const notices = [];

  if (draft.dateOrigin === "inferred_today") {
    notices.push("No indicaste fecha: asumí hoy.");
  }

  if (draft.timeOrigin === "relative") {
    notices.push("La hora se calculó a partir de una expresión relativa.");
  }

  const panel = $("inferenceNotice");

  if (!notices.length) {
    panel.classList.add("hidden");
    panel.textContent = "";
    return;
  }

  panel.textContent = notices.join(" ");
  panel.classList.remove("hidden");
}

function syncDraftFromFields() {
  if (!STATE.draft) return;

  STATE.draft.client = $("clientField").value.trim();
  STATE.draft.phone = $("phoneField").value.trim();
  STATE.draft.address = $("addressField").value.trim();
  STATE.draft.neighborhood = $("neighborhoodField").value.trim();
  STATE.draft.price = $("priceField").value ? Number($("priceField").value) : null;
  STATE.draft.date = $("dateField").value;
  STATE.draft.time = $("timeField").value;
  STATE.draft.reminderOffset = Number($("reminderOffset").value || 0);
  STATE.draft.reminderMode = "manual";
  STATE.draft.description = $("descriptionField").value.trim();

  updateReminderPreview("Ajustado manualmente.");
}

function computeSmartReminder(draft, now = new Date()) {
  if (!draft.date || !draft.time) {
    return { offset: 0, reason: "Sin fecha y hora no puedo calcular un aviso." };
  }

  const work = combineLocalDateTime(draft.date, draft.time);
  const minutesLeft = Math.floor((work - now) / 60_000);

  if (minutesLeft <= 0) {
    return { offset: 0, reason: "La hora indicada ya llegó o pasó." };
  }

  if (minutesLeft <= 30) {
    return { offset: 0, reason: `Faltan ${minutesLeft} min: conviene avisar ahora.` };
  }

  if (minutesLeft <= 90) {
    return { offset: 15, reason: "El trabajo está cerca: aviso 15 min antes." };
  }

  if (minutesLeft <= 180) {
    return { offset: 30, reason: "El trabajo es dentro de pocas horas: aviso 30 min antes." };
  }

  const preferred = Number(getPrefs().defaultReminderOffset || 60);
  const safeOffset = Math.min(preferred, Math.max(30, minutesLeft - 15));

  return {
    offset: safeOffset,
    reason: `Uso tu anticipación habitual: ${offsetLabel(safeOffset)}.`
  };
}

function updateReminderPreview(reasonOverride = "") {
  if (!STATE.draft) return;

  const date = $("dateField").value;
  const time = $("timeField").value;
  const offset = Number($("reminderOffset").value || 0);

  if (!date || !time) {
    $("reminderSuggestion").classList.add("hidden");
    return;
  }

  const workAt = combineLocalDateTime(date, time);
  const now = new Date();

  let remindAt = offset === 0
    ? now
    : new Date(workAt.getTime() - offset * 60_000);

  if (remindAt < now) remindAt = now;

  const minutesUntil = Math.max(0, Math.floor((remindAt - now) / 60_000));

  $("reminderText").textContent = minutesUntil <= 1
    ? "Avisar ahora"
    : `${formatDateTime(remindAt)} · ${offsetLabel(offset)}`;

  $("reminderReason").textContent = reasonOverride || "";
  $("reminderSuggestion").classList.remove("hidden");
}

async function shareDescription() {
  const text = $("descriptionField").value.trim();
  if (!text) return;
  await nativeShareOrCopy(STATE.draft?.job?.title || "Trabajo", text, "Trabajo copiado.");
}

async function copyDescription() {
  const text = $("descriptionField").value.trim();
  if (!text) return;
  await copyText(text);
  toast("Trabajo copiado.");
}

/* ---------------- GUARDAR TRABAJO ---------------- */

function saveCurrentJob() {
  if (!STATE.draft?.job) return;

  syncDraftFromFields();

  const validation = validateCurrentDraft(STATE.draft);

  if (validation) {
    toast(validation);
    return;
  }

  const now = new Date().toISOString();

  const job = {
    ...STATE.draft,
    id: STATE.draft.id || makeId(),
    status: "pendiente",
    createdAt: STATE.draft.createdAt || now,
    updatedAt: now,
    description: $("descriptionField").value.trim(),
    job: {
      id: STATE.draft.job.id,
      title: STATE.draft.job.title,
      actionText: STATE.draft.job.actionText
    },
    events: [
      ...(STATE.draft.events || []),
      {
        type: "creado",
        at: now,
        priceAgreed: STATE.draft.price
      }
    ]
  };

  const jobs = getJobs();
  const existing = jobs.findIndex(item => item.id === job.id);

  if (existing >= 0) jobs[existing] = job;
  else jobs.unshift(job);

  saveJobs(jobs.slice(0, 200));
  upsertReminderForJob(job);

  STATE.draft = job;

  renderJobs();
  renderReminders();
  toast("Trabajo guardado.");
}

function validateCurrentDraft(draft) {
  if (!draft.client) return "Falta el cliente.";
  if (!draft.phone) return "Falta el teléfono.";
  if (!draft.address) return "Falta la dirección.";
  if (draft.price == null) return "Falta el precio acordado.";
  if (!draft.date) return "Falta la fecha.";
  if (!draft.time) return "Falta la hora.";
  return "";
}

/* ---------------- LISTA DE TRABAJOS ---------------- */

function renderJobs() {
  const root = $("jobsList");
  const jobs = getJobs();

  root.innerHTML = "";

  if (!jobs.length) {
    root.innerHTML = `<div class="empty-state">Todavía no guardaste trabajos.</div>`;
    return;
  }

  jobs.forEach(job => {
    const item = document.createElement("article");
    item.className = "job-item";

    const status = job.status || "pendiente";
    const paymentText = paymentStatusLabel(job.payment?.status);

    item.innerHTML = `
      <div class="job-top">
        <div>
          <div class="job-title">${escapeHtml(job.job?.title || "Trabajo")}</div>
          <div class="job-sub">${escapeHtml(job.client || "Sin cliente")} · ${escapeHtml(job.address || "Sin dirección")}</div>
        </div>
        <div>
          <div class="job-price">${job.price != null ? formatMoney(job.price) : "—"}</div>
          <span class="status-pill ${status}">${statusLabel(status)}</span>
        </div>
      </div>

      <div class="job-description">${escapeHtml(shorten(job.description || "", 170))}</div>

      <div class="job-meta">
        <span>${job.date ? formatDateOnly(job.date) : ""} ${job.time || ""}</span>
        <span>${escapeHtml(job.phone || "")}</span>
        ${status === "realizado" ? `<span>${escapeHtml(paymentText)}</span>` : ""}
      </div>

      <div class="job-actions">
        <button class="btn btn-secondary btn-fit" data-share-job="${job.id}">Compartir</button>
        ${status === "pendiente" ? `<button class="btn btn-secondary btn-fit" data-close-job="${job.id}">Registrar resultado</button>` : ""}
        ${status === "realizado" ? `<button class="btn btn-quiet btn-fit" data-summary-job="${job.id}">Ver resumen</button>` : ""}
      </div>
    `;

    root.appendChild(item);
  });

  root.querySelectorAll("[data-share-job]").forEach(button => {
    button.addEventListener("click", () => shareStoredJob(button.dataset.shareJob));
  });

  root.querySelectorAll("[data-close-job]").forEach(button => {
    button.addEventListener("click", () => openCloseFlow(button.dataset.closeJob));
  });

  root.querySelectorAll("[data-summary-job]").forEach(button => {
    button.addEventListener("click", () => showStoredSummary(button.dataset.summaryJob));
  });
}

async function shareStoredJob(id) {
  const job = getJobs().find(item => item.id === id);
  if (!job) return;

  await nativeShareOrCopy(
    job.job?.title || "Trabajo",
    job.description || buildOperationalMessage(job),
    "Trabajo copiado."
  );
}

function showStoredSummary(id) {
  const job = getJobs().find(item => item.id === id);
  if (!job) return;

  const summary = job.finalSummary || buildFinalSummary(job);
  $("finalSummaryField").value = summary;
  STATE.activeJobId = id;

  $("finalSummaryPanel").classList.remove("hidden");
  $("finalSummaryPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- CIERRE DEL SERVICIO ---------------- */

function bindCloseFlow() {
  document.querySelectorAll("[data-close-status]").forEach(button => {
    button.addEventListener("click", () => selectCloseStatus(button.dataset.closeStatus));
  });

  $("cancelCloseBtn").addEventListener("click", closeClosePanel);
  $("saveResultBtn").addEventListener("click", saveJobResult);

  $("paymentStatusField").addEventListener("change", syncPaymentFields);

  $("shareFinalSummaryBtn").addEventListener("click", async () => {
    const text = $("finalSummaryField").value.trim();
    if (!text) return;
    await nativeShareOrCopy("Resumen del servicio", text, "Resumen copiado.");
  });

  $("copyFinalSummaryBtn").addEventListener("click", async () => {
    const text = $("finalSummaryField").value.trim();
    if (!text) return;
    await copyText(text);
    toast("Resumen copiado.");
  });
}

function openCloseFlow(id) {
  const job = getJobs().find(item => item.id === id);
  if (!job) return;

  STATE.activeJobId = id;
  STATE.closeStatus = null;

  $("closeTitle").textContent = `${job.client} · ${job.job?.title || "Trabajo"}`;
  $("finalPriceField").value = job.price ?? "";
  $("paidAmountField").value = job.price ?? "";
  $("paymentStatusField").value = "pagado";
  $("paymentMethodField").value = "";
  $("resultNotesField").value = "";
  $("rescheduleDateField").value = job.date || "";
  $("rescheduleTimeField").value = job.time || "";

  document.querySelectorAll(".status-option").forEach(button => button.classList.remove("selected"));
  $("doneFields").classList.add("hidden");
  $("rescheduleFields").classList.add("hidden");
  $("saveResultBtn").classList.add("hidden");

  $("closePanel").classList.remove("hidden");
  $("closePanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectCloseStatus(status) {
  STATE.closeStatus = status;

  document.querySelectorAll(".status-option").forEach(button => {
    button.classList.toggle("selected", button.dataset.closeStatus === status);
  });

  $("doneFields").classList.toggle("hidden", status !== "realizado");
  $("rescheduleFields").classList.toggle("hidden", status !== "reprogramado");
  $("saveResultBtn").classList.remove("hidden");

  if (status === "realizado") syncPaymentFields();
}

function syncPaymentFields() {
  const job = getJobs().find(item => item.id === STATE.activeJobId);
  if (!job) return;

  const status = $("paymentStatusField").value;
  const finalPrice = Number($("finalPriceField").value || job.price || 0);

  if (status === "pagado") {
    $("paidAmountField").value = finalPrice || "";
  }

  if (status === "pendiente") {
    $("paidAmountField").value = 0;
  }
}

function saveJobResult() {
  const jobs = getJobs();
  const index = jobs.findIndex(item => item.id === STATE.activeJobId);

  if (index < 0 || !STATE.closeStatus) return;

  const job = jobs[index];
  const now = new Date().toISOString();
  const notes = $("resultNotesField").value.trim();

  if (STATE.closeStatus === "realizado") {
    const finalPrice = Number($("finalPriceField").value || job.price || 0);
    const paymentStatus = $("paymentStatusField").value;
    const paidAmount = Number($("paidAmountField").value || 0);
    const method = $("paymentMethodField").value;

    job.status = "realizado";
    job.payment = {
      status: paymentStatus,
      finalPrice,
      paidAmount,
      method
    };

    job.events = [
      ...(job.events || []),
      {
        type: "realizado",
        at: now,
        notes,
        finalPrice,
        paymentStatus,
        paidAmount,
        method
      }
    ];
  }

  if (STATE.closeStatus === "no_realizado") {
    job.status = "no_realizado";
    job.events = [
      ...(job.events || []),
      {
        type: "no_realizado",
        at: now,
        notes
      }
    ];
  }

  if (STATE.closeStatus === "reprogramado") {
    const newDate = $("rescheduleDateField").value;
    const newTime = $("rescheduleTimeField").value;

    if (!newDate || !newTime) {
      toast("Indicá la nueva fecha y hora.");
      return;
    }

    job.status = "pendiente";
    job.date = newDate;
    job.time = newTime;
    job.events = [
      ...(job.events || []),
      {
        type: "reprogramado",
        at: now,
        notes,
        date: newDate,
        time: newTime
      }
    ];

    upsertReminderForJob(job);
  }

  job.updatedAt = now;
  job.finalSummary = buildFinalSummary(job);

  jobs[index] = job;
  saveJobs(jobs);

  if (job.status !== "pendiente") markReminderDoneByJob(job.id);

  renderJobs();
  renderReminders();

  $("finalSummaryField").value = job.finalSummary;
  $("finalSummaryPanel").classList.remove("hidden");

  closeClosePanel();
  $("finalSummaryPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  toast("Servicio actualizado.");
}

function closeClosePanel() {
  $("closePanel").classList.add("hidden");
  STATE.closeStatus = null;
}

function buildFinalSummary(job) {
  const latest = [...(job.events || [])].reverse().find(event =>
    ["realizado","no_realizado","reprogramado"].includes(event.type)
  );

  if (!latest) return job.description || "";

  if (latest.type === "realizado") {
    const sentences = [
      `Servicio realizado para ${job.client} en ${job.address}${job.neighborhood ? `, ${job.neighborhood}` : ""}.`,
      latest.notes ? normalizeSentence(latest.notes) : `${capitalize(job.job?.title || "Trabajo")} realizado.`
    ];

    if (job.price != null && latest.finalPrice != null) {
      if (Number(job.price) === Number(latest.finalPrice)) {
        sentences.push(`El precio acordado y final fue de ${formatMoney(latest.finalPrice)}.`);
      } else {
        sentences.push(`El precio acordado era de ${formatMoney(job.price)} y el importe final fue de ${formatMoney(latest.finalPrice)}.`);
      }
    }

    if (latest.paymentStatus === "pagado") {
      sentences.push(`El servicio quedó pagado${latest.method ? ` mediante ${paymentMethodLabel(latest.method)}` : ""}.`);
    } else if (latest.paymentStatus === "parcial") {
      sentences.push(`Se pagaron ${formatMoney(latest.paidAmount)} y quedó un saldo pendiente de ${formatMoney(Math.max(0, latest.finalPrice - latest.paidAmount))}.`);
    } else {
      sentences.push(`El pago quedó pendiente.`);
    }

    return sentences.join(" ");
  }

  if (latest.type === "no_realizado") {
    return `El servicio para ${job.client} no se pudo realizar.${latest.notes ? ` ${normalizeSentence(latest.notes)}` : ""}`;
  }

  if (latest.type === "reprogramado") {
    return `El trabajo para ${job.client} fue reprogramado para ${formatDateOnly(latest.date)} a las ${latest.time}.${latest.notes ? ` ${normalizeSentence(latest.notes)}` : ""}`;
  }

  return job.description || "";
}

/* ---------------- RECORDATORIOS ---------------- */

function upsertReminderForJob(job) {
  if (!job.date || !job.time) return;

  const reminders = getReminders();
  const index = reminders.findIndex(item => item.jobId === job.id);
  const workAt = combineLocalDateTime(job.date, job.time);

  const smart = job.reminderMode === "manual"
    ? { offset: Number(job.reminderOffset || 0) }
    : computeSmartReminder(job);

  let remindAt = smart.offset === 0
    ? new Date()
    : new Date(workAt.getTime() - smart.offset * 60_000);

  if (remindAt < new Date()) remindAt = new Date();

  const reminder = {
    id: index >= 0 ? reminders[index].id : makeId(),
    jobId: job.id,
    title: job.job?.title || "Trabajo",
    client: job.client || "",
    address: job.address || "",
    workAt: workAt.toISOString(),
    remindAt: remindAt.toISOString(),
    offset: smart.offset,
    done: false
  };

  if (index >= 0) reminders[index] = reminder;
  else reminders.push(reminder);

  saveReminders(reminders);
}

function renderReminders() {
  const root = $("remindersList");
  const reminders = getReminders().sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt));

  root.innerHTML = "";

  const todayKey = toDateInput(new Date());
  let today = 0;
  let upcoming = 0;
  let done = 0;

  reminders.forEach(item => {
    if (item.done) {
      done++;
      return;
    }

    const key = toDateInput(new Date(item.remindAt));

    if (key === todayKey) today++;
    else if (new Date(item.remindAt) > new Date()) upcoming++;
  });

  $("metricToday").textContent = today;
  $("metricUpcoming").textContent = upcoming;
  $("metricDone").textContent = done;

  const pending = reminders.filter(item => !item.done);

  if (!pending.length) {
    root.innerHTML = `<div class="empty-state">No hay recordatorios pendientes.</div>`;
    return;
  }

  pending.forEach(item => {
    const remindAt = new Date(item.remindAt);
    const workAt = new Date(item.workAt);
    const now = new Date();
    const isNow = remindAt <= now;

    const article = document.createElement("article");
    article.className = "reminder-item";

    article.innerHTML = `
      <div class="reminder-time">${isNow ? "AHORA" : `${String(remindAt.getHours()).padStart(2,"0")}:${String(remindAt.getMinutes()).padStart(2,"0")}`}</div>
      <div class="reminder-content">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.client)} · ${escapeHtml(item.address)}</span>
        <span>Trabajo ${formatDateTime(workAt)}</span>
      </div>
      <div class="reminder-actions v4-reminder-state-actions">
        <button
          class="icon-btn v4-state-action"
          data-v4-reminder-action="reprogramado"
          data-v4-reminder-job-id="${item.jobId || ""}"
          title="Reprogramar"
          aria-label="Reprogramar trabajo"
        >🕐</button>
        <button
          class="icon-btn v4-state-action"
          data-v4-reminder-action="no_realizado"
          data-v4-reminder-job-id="${item.jobId || ""}"
          title="No realizado"
          aria-label="Marcar como no realizado"
        >❌</button>
        <button
          class="icon-btn v4-state-action"
          data-v4-reminder-action="realizado"
          data-v4-reminder-job-id="${item.jobId || ""}"
          title="Realizado"
          aria-label="Marcar como realizado"
        >✅</button>
      </div>
    `;

    root.appendChild(article);
  });

  root.querySelectorAll("[data-done-reminder]").forEach(button => {
    button.addEventListener("click", () => {
      markReminderDone(button.dataset.doneReminder);
      renderReminders();
    });
  });

  root.querySelectorAll("[data-snooze-reminder]").forEach(button => {
    button.addEventListener("click", () => {
      snoozeReminder(button.dataset.snoozeReminder, 15);
      renderReminders();
    });
  });
}

function markReminderDone(id) {
  const reminders = getReminders();
  const item = reminders.find(reminder => reminder.id === id);
  if (!item) return;

  item.done = true;
  saveReminders(reminders);
  toast("Recordatorio completado.");
}

function markReminderDoneByJob(jobId) {
  const reminders = getReminders();
  reminders.forEach(item => {
    if (item.jobId === jobId) item.done = true;
  });
  saveReminders(reminders);
}

function snoozeReminder(id, minutes) {
  const reminders = getReminders();
  const item = reminders.find(reminder => reminder.id === id);
  if (!item) return;

  item.remindAt = new Date(Date.now() + minutes * 60_000).toISOString();
  saveReminders(reminders);
  toast(`Pospuesto ${minutes} min.`);
}

/* ---------------- PERFIL Y PAGOS ---------------- */

function bindProfile() {
  ["profileName","profileTrade","profileBusiness","profilePhone","profileEmail","profileInstagram"].forEach(id => {
    $(id).addEventListener("input", renderProfilePreview);
  });

  $("logoInput").addEventListener("change", handleLogo);
  $("saveProfileBtn").addEventListener("click", saveProfile);
  $("shareProfileBtn").addEventListener("click", shareProfile);
  $("savePaymentsBtn").addEventListener("click", savePayments);
}

function defaultProfile() {
  return {
    name: "",
    trade: "",
    business: "",
    phone: "",
    email: "",
    instagram: "",
    logo: ""
  };
}

function getProfile() {
  try {
    return { ...defaultProfile(), ...JSON.parse(localStorage.getItem("trabajo.profile.v3") || "{}") };
  } catch {
    return defaultProfile();
  }
}

function loadProfileIntoForm() {
  const profile = getProfile();

  $("profileName").value = profile.name || "";
  $("profileTrade").value = profile.trade || "";
  $("profileBusiness").value = profile.business || "";
  $("profilePhone").value = profile.phone || "";
  $("profileEmail").value = profile.email || "";
  $("profileInstagram").value = profile.instagram || "";
}

function saveProfile() {
  const previous = getProfile();

  const profile = {
    name: $("profileName").value.trim(),
    trade: $("profileTrade").value.trim(),
    business: $("profileBusiness").value.trim(),
    phone: $("profilePhone").value.trim(),
    email: $("profileEmail").value.trim(),
    instagram: $("profileInstagram").value.trim(),
    logo: previous.logo || ""
  };

  localStorage.setItem("trabajo.profile.v3", JSON.stringify(profile));
  renderProfilePreview();
  updateGreeting();
  toast("Perfil guardado.");
}

function renderProfilePreview() {
  if (!$("previewName")) return;

  const saved = getProfile();

  const profile = {
    ...saved,
    name: $("profileName")?.value.trim() || saved.name,
    trade: $("profileTrade")?.value.trim() || saved.trade,
    business: $("profileBusiness")?.value.trim() || saved.business,
    phone: $("profilePhone")?.value.trim() || saved.phone,
    email: $("profileEmail")?.value.trim() || saved.email,
    instagram: $("profileInstagram")?.value.trim() || saved.instagram
  };

  $("previewName").textContent = profile.name || "Tu nombre";
  $("previewTrade").textContent = profile.trade || profile.business || "Tu oficio o actividad";
  $("profileInitials").textContent = getInitials(profile.name || profile.business || "TU");

  if (saved.logo) {
    $("profileLogo").src = saved.logo;
    $("profileLogo").classList.remove("hidden");
    $("profileInitials").classList.add("hidden");
  } else {
    $("profileLogo").classList.add("hidden");
    $("profileInitials").classList.remove("hidden");
  }

  const rows = [];
  if (profile.phone) rows.push(["Teléfono", profile.phone]);
  if (profile.email) rows.push(["Email", profile.email]);
  if (profile.instagram) rows.push(["Instagram", profile.instagram]);

  $("previewContacts").innerHTML = rows.length
    ? rows.map(([key, value]) => `<div class="contact-row"><span>${escapeHtml(key)}</span><span>${escapeHtml(value)}</span></div>`).join("")
    : `<div class="empty-state">Completá tus datos para ver tu tarjeta.</div>`;
}

async function handleLogo(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (file.size > 1_500_000) {
    toast("Elegí una imagen de menos de 1,5 MB.");
    return;
  }

  const dataUrl = await fileToDataUrl(file);
  const profile = getProfile();
  profile.logo = dataUrl;

  localStorage.setItem("trabajo.profile.v3", JSON.stringify(profile));
  renderProfilePreview();
  toast("Imagen guardada.");
}

async function shareProfile() {
  saveProfile();

  const profile = getProfile();
  const payments = getPayments();

  const lines = [
    profile.name || profile.business || "Contacto",
    profile.trade || "",
    profile.business && profile.business !== profile.name ? profile.business : "",
    profile.phone ? `Tel: ${profile.phone}` : "",
    profile.email ? `Email: ${profile.email}` : "",
    profile.instagram ? `Instagram: ${profile.instagram}` : "",
    paymentShareText(payments)
  ].filter(Boolean);

  await nativeShareOrCopy(profile.name || "Mi tarjeta", lines.join("\n"), "Tarjeta copiada.");
}

function defaultPayments() {
  return {
    cash: true,
    bankName: "",
    bankHolder: "",
    bankAccount: "",
    linkLabel: "",
    linkUrl: ""
  };
}

function getPayments() {
  try {
    return { ...defaultPayments(), ...JSON.parse(localStorage.getItem("trabajo.payments.v3") || "{}") };
  } catch {
    return defaultPayments();
  }
}

function loadPaymentsIntoForm() {
  const payments = getPayments();

  $("payCash").checked = payments.cash;
  $("bankName").value = payments.bankName || "";
  $("bankHolder").value = payments.bankHolder || "";
  $("bankAccount").value = payments.bankAccount || "";
  $("paymentLinkLabel").value = payments.linkLabel || "";
  $("paymentLinkUrl").value = payments.linkUrl || "";
}

function savePayments() {
  const payments = {
    cash: $("payCash").checked,
    bankName: $("bankName").value.trim(),
    bankHolder: $("bankHolder").value.trim(),
    bankAccount: $("bankAccount").value.trim(),
    linkLabel: $("paymentLinkLabel").value.trim(),
    linkUrl: $("paymentLinkUrl").value.trim()
  };

  localStorage.setItem("trabajo.payments.v3", JSON.stringify(payments));
  toast("Métodos de pago guardados.");
}

function paymentShareText(payments) {
  const parts = [];

  if (payments.cash) parts.push("Efectivo");

  if (payments.bankName && payments.bankAccount) {
    parts.push(`Transferencia ${payments.bankName}: ${payments.bankAccount}${payments.bankHolder ? ` · ${payments.bankHolder}` : ""}`);
  }

  if (payments.linkUrl) {
    parts.push(`${payments.linkLabel || "Link de pago"}: ${payments.linkUrl}`);
  }

  return parts.length ? `Formas de pago: ${parts.join(" | ")}` : "";
}

/* ---------------- PREFERENCIAS ---------------- */

function bindPrefs() {
  $("savePrefsBtn").addEventListener("click", savePrefs);
}

function defaultPrefs() {
  return {
    missingDateBehavior: "today",
    defaultReminderOffset: 60,
    currency: RULES.currency?.code || "UYU"
  };
}

function getPrefs() {
  try {
    return { ...defaultPrefs(), ...JSON.parse(localStorage.getItem("trabajo.prefs.v3") || "{}") };
  } catch {
    return defaultPrefs();
  }
}

function loadPrefsIntoForm() {
  const prefs = getPrefs();

  $("missingDateBehavior").value = prefs.missingDateBehavior || "today";
  $("defaultReminderOffset").value = String(prefs.defaultReminderOffset || 60);
  $("currencySelect").value = prefs.currency || "UYU";
}

function savePrefs() {
  const prefs = {
    missingDateBehavior: $("missingDateBehavior").value || "today",
    defaultReminderOffset: Number($("defaultReminderOffset").value || 60),
    currency: $("currencySelect").value || "UYU"
  };

  localStorage.setItem("trabajo.prefs.v3", JSON.stringify(prefs));
  toast("Preferencias guardadas.");
}

/* ---------------- STORAGE / MIGRACIÓN ---------------- */

function getJobs() {
  try {
    return JSON.parse(localStorage.getItem("trabajo.jobs.v3") || "[]");
  } catch {
    return [];
  }
}

function saveJobs(jobs) {
  localStorage.setItem("trabajo.jobs.v3", JSON.stringify(jobs));
}

function getReminders() {
  try {
    return JSON.parse(localStorage.getItem("trabajo.reminders.v3") || "[]");
  } catch {
    return [];
  }
}

function saveReminders(reminders) {
  localStorage.setItem("trabajo.reminders.v3", JSON.stringify(reminders));
}

function clearJobs() {
  if (!getJobs().length) return;
  if (!confirm("¿Borrar todos los trabajos y recordatorios?")) return;

  localStorage.removeItem("trabajo.jobs.v3");
  localStorage.removeItem("trabajo.reminders.v3");

  renderJobs();
  renderReminders();
  toast("Trabajos eliminados.");
}

function migrateV2Data() {
  if (!localStorage.getItem("trabajo.profile.v3")) {
    try {
      const old = JSON.parse(localStorage.getItem("cotiza.profile.v2") || "null");

      if (old) {
        localStorage.setItem("trabajo.profile.v3", JSON.stringify({
          name: old.name || "",
          trade: old.trade || "",
          business: old.business || "",
          phone: old.phone || "",
          email: old.email || "",
          instagram: old.instagram || "",
          logo: old.logo || ""
        }));
      }
    } catch {}
  }

  if (!localStorage.getItem("trabajo.prefs.v3")) {
    try {
      const old = JSON.parse(localStorage.getItem("cotiza.prefs.v2") || "null");

      if (old) {
        localStorage.setItem("trabajo.prefs.v3", JSON.stringify({
          missingDateBehavior: "today",
          defaultReminderOffset: old.defaultReminderOffset || 60,
          currency: old.currency || "UYU"
        }));
      }
    } catch {}
  }
}

/* ---------------- UTILIDADES ---------------- */

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSentence(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  text = capitalize(text);
  if (!/[.!?]$/.test(text)) text += ".";
  return text;
}

function slugify(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function capitalize(value) {
  const text = String(value || "").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function titleCaseName(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizePhoneInput(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (digits.startsWith("598") && digits.length >= 11) {
    return `0${digits.slice(3,5)} ${digits.slice(5,8)} ${digits.slice(8,11)}`;
  }

  if (digits.length === 8 && digits.startsWith("9")) {
    return `0${digits.slice(0,2)} ${digits.slice(2,5)} ${digits.slice(5,8)}`;
  }

  if (digits.length === 9 && digits.startsWith("09")) {
    return `${digits.slice(0,3)} ${digits.slice(3,6)} ${digits.slice(6,9)}`;
  }

  return value.trim();
}

function looksLikeJobWord(value) {
  const n = normalize(value);
  return RULES.jobs.some(job =>
    (job.keywords || []).some(keyword => normalize(keyword) === n)
  );
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function nextWeekday(now, targetDay) {
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);

  let diff = (targetDay - date.getDay() + 7) % 7;
  if (diff === 0) diff = 7;

  date.setDate(date.getDate() + diff);
  return date;
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function combineLocalDateTime(date, time) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function toDateInput(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toTimeInput(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatMoney(value) {
  const currency = getPrefs().currency || "UYU";

  return new Intl.NumberFormat("es-UY", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDateOnly(value) {
  if (!value) return "";

  return new Intl.DateTimeFormat("es-UY", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(parseLocalDate(value));
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("es-UY", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function humanDuration(minutes) {
  if (minutes < 60) return `${minutes} minutos`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (!rest) return hours === 1 ? "1 hora" : `${hours} horas`;
  return `${hours} h ${rest} min`;
}

function offsetLabel(minutes) {
  if (minutes === 0) return "ahora";
  if (minutes === 15) return "15 min antes";
  if (minutes === 30) return "30 min antes";
  if (minutes === 60) return "1 hora antes";
  if (minutes === 120) return "2 horas antes";
  if (minutes === 180) return "3 horas antes";
  if (minutes === 1440) return "1 día antes";
  return `${minutes} min antes`;
}

function statusLabel(status) {
  const map = {
    pendiente: "Pendiente",
    realizado: "Realizado",
    no_realizado: "No realizado",
    reprogramado: "Reprogramado"
  };

  return map[status] || status;
}

function paymentStatusLabel(status) {
  const map = {
    pagado: "Pagado",
    parcial: "Pago parcial",
    pendiente: "Pago pendiente"
  };

  return map[status] || "";
}

function paymentMethodLabel(method) {
  const map = {
    efectivo: "efectivo",
    transferencia: "transferencia",
    mercado_pago: "Mercado Pago / link de pago",
    otro: "otro medio"
  };

  return map[method] || method;
}

function makeId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getInitials(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "TU";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function shorten(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trim()}…`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

async function nativeShareOrCopy(title, text, fallbackToast) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }

  await copyText(text);
  toast(fallbackToast);
}

let toastTimer = null;

function toast(message) {
  clearTimeout(toastTimer);

  const element = $("toast");
  element.textContent = message;
  element.classList.add("show");

  toastTimer = setTimeout(() => {
    element.classList.remove("show");
  }, 2200);
}

function updateHeaderDate() {
  const now = new Date();

  const date = new Intl.DateTimeFormat("es-UY", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(now);

  const time = new Intl.DateTimeFormat("es-UY", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(now);

  $("headerDate").innerHTML = `${date}<br>${time}`;
}

function updateGreeting() {
  const hour = new Date().getHours();
  const profile = getProfile();
  const firstName = profile.name?.trim().split(/\s+/)[0] || "";

  let greeting = "Buenas noches";

  if (hour < 12) greeting = "Buenos días";
  else if (hour < 20) greeting = "Buenas tardes";

  $("greeting").textContent = firstName ? `${greeting}, ${firstName}` : greeting;
}

/* =========================================================
   V4 · Flujo visual, filtros, detalle editable y recorte
   ========================================================= */

function autoGrowTextarea(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.max(el.scrollHeight, 150)}px`;
}

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
      closeAllV4Overlays();
      const target = button.dataset.target;

      document.querySelectorAll(".page").forEach(page => {
        page.classList.toggle("active", page.dataset.page === target);
      });

      document.querySelectorAll(".nav-item").forEach(item => {
        item.classList.toggle("active", item.dataset.target === target);
      });

      if (target === "reminders") renderReminders();
      if (target === "profile") renderProfilePreview();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  document.querySelectorAll(".summary-card").forEach((card, index) => {
    const fallback = ["upcoming", "today", "pending", "done", "missed"][index] || "today";
    const type = card.dataset.v4Filter || fallback;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.dataset.v4Filter = type;

    const open = () => openV4Filter(type);
    card.addEventListener("click", open);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") open();
    });
  });
}

function saveCurrentJob() {
  if (!STATE.draft?.job) return;

  syncDraftFromFields();
  const validation = validateCurrentDraft(STATE.draft);

  if (validation) {
    toast(validation);
    return;
  }

  const now = new Date().toISOString();

  const job = {
    ...STATE.draft,
    id: STATE.draft.id || makeId(),
    status: "pendiente",
    createdAt: STATE.draft.createdAt || now,
    updatedAt: now,
    description: $("descriptionField").value.trim(),
    job: {
      id: STATE.draft.job.id,
      title: STATE.draft.job.title,
      actionText: STATE.draft.job.actionText
    },
    events: [
      ...(STATE.draft.events || []),
      { type: "creado", at: now, priceAgreed: STATE.draft.price }
    ]
  };

  const jobs = getJobs();
  const existing = jobs.findIndex(item => item.id === job.id);
  if (existing >= 0) jobs[existing] = job;
  else jobs.unshift(job);

  saveJobs(jobs.slice(0, 200));
  upsertReminderForJob(job);

  // V4: después de guardar la ficha completa se comprime.
  STATE.draft = null;
  $("resultPanel").classList.add("hidden");
  $("clarificationPanel").classList.add("hidden");
  $("rawInput").value = "";

  renderJobs();
  renderReminders();
  toast("Trabajo guardado.");

  requestAnimationFrame(() => {
    $("jobsList")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function renderJobs() {
  const root = $("jobsList");
  const jobs = getJobs();
  root.innerHTML = "";

  if (!jobs.length) {
    root.innerHTML = `<div class="empty-state">Todavía no guardaste trabajos.</div>`;
    return;
  }

  jobs.forEach(job => {
    const status = job.status || "pendiente";
    const item = document.createElement("article");
    item.className = "job-item v4-compact";
    item.dataset.v4JobId = job.id;

    item.innerHTML = `
      <div class="job-top">
        <div>
          <div class="job-title">${escapeHtml(job.job?.title || "Trabajo")}</div>
          <div class="job-sub">${job.date ? `${formatDateOnly(job.date)} · ${escapeHtml(job.time || "")}` : "Sin fecha"}</div>
        </div>
        <div class="v432-job-side">
          <button
            class="v432-delete-job"
            data-v4-delete="${job.id}"
            type="button"
            title="Eliminar trabajo"
            aria-label="Eliminar trabajo"
          >×</button>
          <div class="job-price">${job.price != null ? formatMoney(job.price) : "—"}</div>
          <span class="status-pill ${status}">${statusLabel(status)}</span>
        </div>
      </div>

      <div class="job-client-data">
        <strong>${escapeHtml(job.client || "Sin cliente")}</strong>
        <span>${escapeHtml(job.phone || "Sin teléfono")}</span>
        <span>${escapeHtml(job.address || "Sin dirección")}${job.neighborhood ? ` · ${escapeHtml(job.neighborhood)}` : ""}</span>
      </div>

      <div class="job-actions">
        <button class="btn btn-secondary btn-fit" data-v4-share="${job.id}">Compartir</button>
        ${status === "pendiente" ? `<button class="btn btn-secondary btn-fit" data-v4-result="${job.id}">Registrar resultado</button>` : ""}
      </div>
    `;

    root.appendChild(item);
  });

  root.querySelectorAll("[data-v4-job-id]").forEach(card => {
    card.addEventListener("click", event => {
      if (event.target.closest("button")) return;
      openV4JobDetail(card.dataset.v4JobId);
    });
  });

  root.querySelectorAll("[data-v4-share]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      shareStoredJob(button.dataset.v4Share);
    });
  });

  root.querySelectorAll("[data-v4-result]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      openV4ResultOverlay(button.dataset.v4Result);
    });
  });

  root.querySelectorAll("[data-v4-delete]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      deleteV432Job(button.dataset.v4Delete);
    });
  });
}

function deleteV432Job(id) {
  const jobs = getJobs();
  const job = jobs.find(item => item.id === id);
  if (!job) return;

  if (!confirm("¿Deseas eliminar este trabajo?")) return;

  saveJobs(jobs.filter(item => item.id !== id));
  saveReminders(getReminders().filter(item => item.jobId !== id));

  if (STATE.activeJobId === id) STATE.activeJobId = null;

  document.querySelectorAll(".v4-job-detail-overlay, .v4-result-overlay").forEach(el => el.remove());
  renderJobs();
  renderReminders();
  refreshOpenV4Filter();
  toast("Trabajo eliminado.");
}

function renderReminders() {
  const root = $("remindersList");
  const jobs = getJobs();
  const reminders = getReminders().sort((a, b) => new Date(a.workAt) - new Date(b.workAt));
  const todayKey = toDateInput(new Date());

  const todayJobs = jobs.filter(job => job.status === "pendiente" && job.date === todayKey);
  const upcomingJobs = jobs.filter(job => job.status === "pendiente" && job.date && job.date > todayKey);
  const pendingJobs = jobs.filter(job => job.status === "pendiente" && (!job.date || job.date < todayKey));
  const doneJobs = jobs.filter(job => job.status === "realizado");
  const missedJobs = jobs.filter(job => job.status === "no_realizado");

  $("metricToday").textContent = todayJobs.length;
  $("metricUpcoming").textContent = upcomingJobs.length;
  $("metricPending").textContent = pendingJobs.length;
  $("metricDone").textContent = doneJobs.length;
  $("metricMissed").textContent = missedJobs.length;

  root.innerHTML = "";
  const pending = reminders.filter(item => !item.done);

  if (!pending.length) {
    root.innerHTML = `<div class="empty-state">No hay recordatorios pendientes.</div>`;
    return;
  }

  pending.forEach(item => {
    const workAt = new Date(item.workAt);
    const moment = v431ReminderMoment(workAt, new Date());

    const article = document.createElement("article");
    article.className = "reminder-item v431-reminder-card";
    article.dataset.v4ReminderJob = item.jobId || "";

    article.innerHTML = `
      <div class="v431-reminder-moment ${moment.tone}">
        <strong>${escapeHtml(moment.main)}</strong>
        ${moment.sub ? `<span>${escapeHtml(moment.sub)}</span>` : ""}
      </div>

      <div class="reminder-content v431-reminder-copy">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.client)} · ${escapeHtml(item.address)}</span>
        <span>${escapeHtml(moment.detail)}</span>
      </div>

      <div class="v431-reminder-actions" aria-label="Acciones del trabajo">
        <button
          class="v431-reminder-action v431-reminder-action--reschedule"
          data-v4-reminder-action="reprogramado"
          data-v4-reminder-job-id="${item.jobId || ""}"
          type="button"
          title="Reprogramar"
          aria-label="Reprogramar trabajo"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8"></circle>
            <path d="M12 8v4.7l3 1.8"></path>
            <path d="M7.2 5.1H4.8v2.4"></path>
            <path d="M4.9 7.2A8.7 8.7 0 0 1 7.2 5"></path>
          </svg>
        </button>

        <button
          class="v431-reminder-action v431-reminder-action--done"
          data-v4-reminder-action="realizado"
          data-v4-reminder-job-id="${item.jobId || ""}"
          type="button"
          title="Hecho"
          aria-label="Marcar como realizado"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8"></circle>
            <path d="M8.5 12.2l2.2 2.2 4.9-5"></path>
          </svg>
        </button>

        <button
          class="v431-reminder-action v431-reminder-action--missed"
          data-v4-reminder-action="no_realizado"
          data-v4-reminder-job-id="${item.jobId || ""}"
          type="button"
          title="No realizado"
          aria-label="Marcar como no realizado"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8"></circle>
            <path d="M9 9l6 6M15 9l-6 6"></path>
          </svg>
        </button>
      </div>
    `;

    root.appendChild(article);
  });

  root.querySelectorAll("[data-v4-reminder-job]").forEach(card => {
    card.addEventListener("click", event => {
      if (event.target.closest("button")) return;
      const id = card.dataset.v4ReminderJob;
      if (id) openV4JobDetail(id);
    });
  });

  root.querySelectorAll("[data-v4-reminder-action]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();

      const jobId = button.dataset.v4ReminderJobId;
      const action = button.dataset.v4ReminderAction;

      if (!jobId) {
        toast("No pude vincular este recordatorio con su trabajo.");
        return;
      }

      openV4ResultOverlay(jobId, null, action, true);
    });
  });
}

function v431ReminderMoment(workAt, now = new Date()) {
  if (!(workAt instanceof Date) || Number.isNaN(workAt.getTime())) {
    return { main: "SIN FECHA", sub: "", detail: "Revisá fecha y hora", tone: "is-future" };
  }

  const diffMinutes = Math.round((workAt - now) / 60000);
  const workDate = toDateInput(workAt);
  const today = toDateInput(now);
  const tomorrow = toDateInput(addDays(now, 1));
  const hhmm = `${String(workAt.getHours()).padStart(2, "0")}:${String(workAt.getMinutes()).padStart(2, "0")}`;

  if (diffMinutes >= -20 && diffMinutes <= 10) {
    return { main: "AHORA", sub: hhmm, detail: `Trabajo hoy a las ${hhmm}`, tone: "is-now" };
  }

  if (diffMinutes > 10 && diffMinutes < 60) {
    return { main: `EN ${diffMinutes} MIN`, sub: hhmm, detail: `Trabajo hoy a las ${hhmm}`, tone: "is-soon" };
  }

  if (workDate === today) {
    return { main: "HOY", sub: hhmm, detail: `Trabajo hoy a las ${hhmm}`, tone: "is-today" };
  }

  if (workDate === tomorrow) {
    return { main: "MAÑANA", sub: hhmm, detail: `Trabajo mañana a las ${hhmm}`, tone: "is-future" };
  }

  const day = String(workAt.getDate()).padStart(2, "0");
  const month = new Intl.DateTimeFormat("es-UY", { month: "short" })
    .format(workAt)
    .replace(".", "")
    .toUpperCase();

  return {
    main: `${day} ${month}`,
    sub: hhmm,
    detail: `Trabajo ${formatDateOnly(workDate)} a las ${hhmm}`,
    tone: "is-future"
  };
}

function createV4Overlay(title, extraClass = "") {
  const overlay = document.createElement("div");
  overlay.className = `v4-overlay ${extraClass}`.trim();
  overlay.innerHTML = `
    <div class="v4-overlay-inner">
      <div class="v4-overlay-head">
        <button class="v4-back" type="button">← Volver</button>
        <div class="v4-overlay-title">${escapeHtml(title)}</div>
      </div>
      <div class="v4-overlay-content"></div>
    </div>
  `;

  document.body.appendChild(overlay);
  return overlay;
}

function closeV4Overlay(overlay) {
  overlay?.remove();
}

function closeAllV4Overlays() {
  document.querySelectorAll(".v4-overlay, .v4-photo-modal").forEach(el => el.remove());
}

function v4JobDetailHTML(job) {
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <span class="eyebrow">Detalle del trabajo</span>
          <h2>${escapeHtml(job.job?.title || "Trabajo")}</h2>
        </div>
        <span class="status-pill ${job.status || "pendiente"}">${statusLabel(job.status || "pendiente")}</span>
      </div>

      <div class="v4-detail-grid">
        <div><span>Cliente</span><strong>${escapeHtml(job.client || "—")}</strong></div>
        <div><span>Teléfono</span><strong>${escapeHtml(job.phone || "—")}</strong></div>
        <div class="wide"><span>Dirección</span><strong>${escapeHtml([job.address, job.neighborhood].filter(Boolean).join(", ") || "—")}</strong></div>
        <div><span>Precio acordado</span><strong>${job.price != null ? formatMoney(job.price) : "—"}</strong></div>
        <div><span>Fecha / hora</span><strong>${job.date ? `${formatDateOnly(job.date)} · ${escapeHtml(job.time || "")}` : "—"}</strong></div>
      </div>

      <div class="v4-message">
        <span class="eyebrow">Mensaje operativo</span>
        <p>${escapeHtml(job.description || buildOperationalMessage(job))}</p>
      </div>

      ${job.finalSummary ? `
        <div class="v4-message">
          <span class="eyebrow">Resumen del servicio</span>
          <p>${escapeHtml(job.finalSummary)}</p>
        </div>
      ` : ""}

      <div class="job-actions">
        <button class="btn btn-secondary btn-fit" data-v4-edit-detail>Editar datos</button>
        <button class="btn btn-secondary btn-fit" data-v4-share-detail>Compartir</button>
        <button class="btn btn-primary btn-fit" data-v4-result-detail>Cambiar estado</button>
      </div>
    </section>
  `;
}

function openV4JobDetail(id) {
  const job = getJobs().find(item => item.id === id);
  if (!job) return;

  STATE.activeJobId = id;
  const overlay = createV4Overlay("Trabajo", "v4-job-detail-overlay");
  const content = overlay.querySelector(".v4-overlay-content");

  const render = () => {
    const current = getJobs().find(item => item.id === id);
    if (!current) {
      closeV4Overlay(overlay);
      return;
    }

    content.innerHTML = v4JobDetailHTML(current);

    content.querySelector("[data-v4-edit-detail]")?.addEventListener("click", () => renderV4JobEdit(overlay, current, render));
    content.querySelector("[data-v4-share-detail]")?.addEventListener("click", () => shareStoredJob(id));
    content.querySelector("[data-v4-result-detail]")?.addEventListener("click", () => openV4ResultOverlay(id, render));
  };

  overlay.querySelector(".v4-back").addEventListener("click", () => closeV4Overlay(overlay));
  render();
}

function renderV4JobEdit(overlay, job, onSaved) {
  const content = overlay.querySelector(".v4-overlay-content");
  overlay.querySelector(".v4-overlay-title").textContent = "Editar trabajo";

  content.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <div>
          <span class="eyebrow">Datos del trabajo</span>
          <h2>${escapeHtml(job.job?.title || "Trabajo")}</h2>
        </div>
      </div>

      <div class="field-grid">
        <label><span>Cliente</span><input id="v4EditClient" type="text" value="${escapeHtml(job.client || "")}"></label>
        <label><span>Teléfono</span><input id="v4EditPhone" type="tel" value="${escapeHtml(job.phone || "")}"></label>
        <label class="wide"><span>Dirección</span><input id="v4EditAddress" type="text" value="${escapeHtml(job.address || "")}"></label>
        <label><span>Barrio</span><input id="v4EditNeighborhood" type="text" value="${escapeHtml(job.neighborhood || "")}"></label>
        <label><span>Precio acordado</span><input id="v4EditPrice" type="number" inputmode="decimal" value="${job.price ?? ""}"></label>
        <label>
          <span>Estado</span>
          <select id="v4EditStatus">
            <option value="pendiente" ${job.status === "pendiente" ? "selected" : ""}>Pendiente</option>
            <option value="realizado" ${job.status === "realizado" ? "selected" : ""}>Realizado</option>
            <option value="no_realizado" ${job.status === "no_realizado" ? "selected" : ""}>No realizado</option>
          </select>
        </label>
        <label><span>Fecha</span><input id="v4EditDate" type="date" value="${escapeHtml(job.date || "")}"></label>
        <label><span>Hora</span><input id="v4EditTime" type="time" value="${escapeHtml(job.time || "")}"></label>
      </div>

      <label class="notes-label">
        <span>Mensaje operativo</span>
        <textarea id="v4EditDescription" rows="8">${escapeHtml(job.description || "")}</textarea>
      </label>

      <div class="job-actions">
        <button class="btn btn-primary btn-fit" data-v4-save-edit>Guardar cambios</button>
        <button class="btn btn-quiet btn-fit" data-v4-cancel-edit>Cancelar</button>
      </div>
    </section>
  `;

  const textarea = content.querySelector("#v4EditDescription");
  requestAnimationFrame(() => autoGrowTextarea(textarea));

  content.querySelector("[data-v4-cancel-edit]").addEventListener("click", () => {
    overlay.querySelector(".v4-overlay-title").textContent = "Trabajo";
    onSaved();
  });

  content.querySelector("[data-v4-save-edit]").addEventListener("click", () => {
    const jobs = getJobs();
    const index = jobs.findIndex(item => item.id === job.id);
    if (index < 0) return;

    const updated = jobs[index];
    updated.client = content.querySelector("#v4EditClient").value.trim();
    updated.phone = content.querySelector("#v4EditPhone").value.trim();
    updated.address = content.querySelector("#v4EditAddress").value.trim();
    updated.neighborhood = content.querySelector("#v4EditNeighborhood").value.trim();
    updated.price = content.querySelector("#v4EditPrice").value ? Number(content.querySelector("#v4EditPrice").value) : null;
    updated.date = content.querySelector("#v4EditDate").value;
    updated.time = content.querySelector("#v4EditTime").value;

    const previousStatus = updated.status || "pendiente";
    const newStatus = content.querySelector("#v4EditStatus").value || "pendiente";
    updated.status = newStatus;

    updated.description = content.querySelector("#v4EditDescription").value.trim();
    updated.updatedAt = new Date().toISOString();

    if (previousStatus !== newStatus) {
      updated.events = [...(updated.events || []), {
        type: "estado_manual",
        at: updated.updatedAt,
        from: previousStatus,
        to: newStatus
      }];

      // Si se vuelve a Pendiente, el servicio queda abierto de nuevo.
      if (newStatus === "pendiente") {
        updated.finalSummary = "";
      }
    }

    jobs[index] = updated;
    saveJobs(jobs);

    if (newStatus === "pendiente") {
      // Reactiva/actualiza el aviso si el trabajo vuelve a estar pendiente.
      upsertReminderForJob(updated);
    } else {
      // Realizado o No realizado ya no debe seguir apareciendo como recordatorio pendiente.
      markReminderDoneByJob(updated.id);
    }

    renderJobs();
    renderReminders();
    refreshOpenV4Filter();

    toast("Cambios guardados.");
    overlay.querySelector(".v4-overlay-title").textContent = "Trabajo";
    onSaved();
  });
}

function v4FilterJobs(type) {
  const jobs = getJobs();
  const today = toDateInput(new Date());

  if (type === "today") {
    return jobs
      .filter(job => job.status === "pendiente" && job.date === today)
      .sort((a,b) => String(a.time || "").localeCompare(String(b.time || "")));
  }

  if (type === "upcoming") {
    return jobs
      .filter(job => job.status === "pendiente" && job.date && job.date > today)
      .sort((a,b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }

  if (type === "pending") {
    return jobs
      .filter(job => job.status === "pendiente" && (!job.date || job.date < today))
      .sort((a,b) => `${a.date || ""} ${a.time || ""}`.localeCompare(`${b.date || ""} ${b.time || ""}`));
  }

  if (type === "done") {
    return jobs
      .filter(job => job.status === "realizado")
      .sort((a,b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  return jobs
    .filter(job => job.status === "no_realizado")
    .sort((a,b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function v4FilterTitle(type) {
  const titles = {
    upcoming: "Próximos",
    today: "Hoy",
    pending: "Pendientes",
    done: "Hechos",
    missed: "No realizados"
  };
  return titles[type] || "Trabajos";
}

function openV4Filter(type) {
  document.querySelector(".v4-filter-overlay")?.remove();

  STATE.v4FilterType = type;
  const overlay = createV4Overlay(v4FilterTitle(type), "v4-filter-overlay");
  overlay.dataset.filterType = type;
  overlay.querySelector(".v4-back").textContent = "← Recordatorios";
  overlay.querySelector(".v4-back").addEventListener("click", () => closeV4Overlay(overlay));

  renderV4FilterOverlay(overlay, type);
}

function renderV4FilterOverlay(overlay, type) {
  const list = v4FilterJobs(type);
  const content = overlay.querySelector(".v4-overlay-content");
  const singular = list.length === 1;

  const filterHelp = type === "pending"
    ? "Trabajos que quedaron abiertos y ya pasaron de fecha."
    : type === "missed"
      ? "Trabajos marcados como no realizados."
      : `${list.length} trabajo${singular ? "" : "s"}.`;

  content.innerHTML = `
    <div class="intro subview-intro">
      <p class="greeting">${escapeHtml(v4FilterTitle(type))}</p>
      <p class="intro-copy">${escapeHtml(filterHelp)}</p>
    </div>
    <div class="v4-filter-list"></div>
  `;

  const root = content.querySelector(".v4-filter-list");

  if (!list.length) {
    root.innerHTML = `<div class="empty-state">No hay trabajos en esta categoría.</div>`;
    return;
  }

  list.forEach(job => {
    const card = document.createElement("article");
    card.className = "v4-filter-card";
    card.dataset.v4FilterJob = job.id;
    card.innerHTML = `
      <div class="job-top">
        <div>
          <div class="job-title">${escapeHtml(job.job?.title || "Trabajo")}</div>
          <div class="job-sub">${escapeHtml(job.client || "")} · ${escapeHtml(job.address || "")}</div>
        </div>
        <span class="status-pill ${job.status || "pendiente"}">${statusLabel(job.status || "pendiente")}</span>
      </div>
      <div class="job-meta">
        <span>${job.date ? formatDateOnly(job.date) : ""} · ${escapeHtml(job.time || "")}</span>
        <span>${job.price != null ? formatMoney(job.price) : ""}</span>
      </div>
    `;
    root.appendChild(card);
  });

  root.querySelectorAll("[data-v4-filter-job]").forEach(card => {
    card.addEventListener("click", () => openV4JobDetail(card.dataset.v4FilterJob));
  });
}

function refreshOpenV4Filter() {
  const overlay = document.querySelector(".v4-filter-overlay");
  if (!overlay) return;
  renderV4FilterOverlay(overlay, overlay.dataset.filterType || STATE.v4FilterType || "today");
}

function openV4ResultOverlay(id, onSavedDetail = null, presetStatus = null, returnToReminders = false) {
  const job = getJobs().find(item => item.id === id);
  if (!job) return;

  const overlay = createV4Overlay(returnToReminders ? "Actualizar trabajo" : "Registrar resultado", "v4-result-overlay");
  const content = overlay.querySelector(".v4-overlay-content");

  content.innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <div>
          <span class="eyebrow">${escapeHtml(job.client || "Cliente")}</span>
          <h2>${escapeHtml(job.job?.title || "Trabajo")}</h2>
        </div>
      </div>

      <div class="status-options">
        <button class="status-option" data-v4-status="reprogramado">Reprogramar</button>
        <button class="status-option" data-v4-status="realizado">Hecho</button>
        <button class="status-option" data-v4-status="no_realizado">No realizado</button>
      </div>

      <div data-v4-done-fields class="hidden">
        <div class="field-grid">
          <label><span>Precio final</span><input data-v4-final-price type="number" inputmode="decimal" value="${job.price ?? ""}"></label>
          <label>
            <span>Estado del pago</span>
            <select data-v4-payment-status>
              <option value="pagado">Pagado</option>
              <option value="parcial">Pago parcial</option>
              <option value="pendiente">Pendiente</option>
            </select>
          </label>
          <label><span>Importe pagado</span><input data-v4-paid-amount type="number" inputmode="decimal" value="${job.price ?? ""}"></label>
          <label>
            <span>Método de pago</span>
            <select data-v4-payment-method>
              <option value="">Sin especificar</option>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="mercado_pago">Mercado Pago / link</option>
              <option value="otro">Otro</option>
            </select>
          </label>
        </div>
      </div>

      <div data-v4-reschedule-fields class="hidden">
        <div class="field-grid">
          <label><span>Nueva fecha</span><input data-v4-reschedule-date type="date" value="${escapeHtml(job.date || "")}"></label>
          <label><span>Nueva hora</span><input data-v4-reschedule-time type="time" value="${escapeHtml(job.time || "")}"></label>
        </div>
      </div>

      <label class="notes-label">
        <span>¿Qué pasó?</span>
        <textarea data-v4-result-notes rows="5" placeholder="Contalo como te salga..."></textarea>
      </label>

      <button data-v4-save-result class="btn btn-primary hidden">Aceptar</button>
    </section>
  `;

  let selected = null;
  const doneFields = content.querySelector("[data-v4-done-fields]");
  const rescheduleFields = content.querySelector("[data-v4-reschedule-fields]");
  const saveButton = content.querySelector("[data-v4-save-result]");
  const paymentStatus = content.querySelector("[data-v4-payment-status]");
  const paidAmount = content.querySelector("[data-v4-paid-amount]");
  const finalPrice = content.querySelector("[data-v4-final-price]");

  const applySelectedStatus = status => {
    selected = status;

    content.querySelectorAll("[data-v4-status]").forEach(button => {
      button.classList.toggle("selected", button.dataset.v4Status === status);
    });

    doneFields.classList.toggle("hidden", status !== "realizado");
    rescheduleFields.classList.toggle("hidden", status !== "reprogramado");
    saveButton.textContent = status === "reprogramado" ? "Actualizar recordatorio" : "Aceptar";
    saveButton.classList.remove("hidden");
  };

  content.querySelectorAll("[data-v4-status]").forEach(button => {
    button.addEventListener("click", () => {
      applySelectedStatus(button.dataset.v4Status);
    });
  });

  if (presetStatus) {
    applySelectedStatus(presetStatus);
  }

  paymentStatus.addEventListener("change", () => {
    if (paymentStatus.value === "pagado") paidAmount.value = finalPrice.value || job.price || "";
    if (paymentStatus.value === "pendiente") paidAmount.value = 0;
  });

  if (returnToReminders) {
    overlay.querySelector(".v4-back").textContent = "← Recordatorios";
  }

  overlay.querySelector(".v4-back").addEventListener("click", () => closeV4Overlay(overlay));

  saveButton.addEventListener("click", () => {
    if (!selected) return;

    const jobs = getJobs();
    const index = jobs.findIndex(item => item.id === id);
    if (index < 0) return;

    const current = jobs[index];
    const now = new Date().toISOString();
    const notes = content.querySelector("[data-v4-result-notes]").value.trim();

    if (selected === "realizado") {
      const final = Number(finalPrice.value || current.price || 0);
      const payStatus = paymentStatus.value;
      const paid = Number(paidAmount.value || 0);
      const method = content.querySelector("[data-v4-payment-method]").value;

      current.status = "realizado";
      current.payment = { status: payStatus, finalPrice: final, paidAmount: paid, method };
      current.events = [...(current.events || []), {
        type: "realizado", at: now, notes, finalPrice: final,
        paymentStatus: payStatus, paidAmount: paid, method
      }];
    }

    if (selected === "no_realizado") {
      current.status = "no_realizado";
      current.events = [...(current.events || []), { type: "no_realizado", at: now, notes }];
    }

    if (selected === "reprogramado") {
      const date = content.querySelector("[data-v4-reschedule-date]").value;
      const time = content.querySelector("[data-v4-reschedule-time]").value;

      if (!date || !time) {
        toast("Indicá la nueva fecha y hora.");
        return;
      }

      current.status = "pendiente";
      current.date = date;
      current.time = time;
      current.events = [...(current.events || []), { type: "reprogramado", at: now, notes, date, time }];
      upsertReminderForJob(current);
    }

    current.updatedAt = now;
    current.finalSummary = buildFinalSummary(current);
    jobs[index] = current;
    saveJobs(jobs);

    if (current.status !== "pendiente") markReminderDoneByJob(current.id);

    renderJobs();
    renderReminders();
    refreshOpenV4Filter();
    closeV4Overlay(overlay);

    if (returnToReminders) {
      // El recordatorio desaparece si quedó cerrado. Si fue reprogramado,
      // vuelve a la agenda según la nueva fecha/hora.
      document.querySelectorAll(".v4-job-detail-overlay").forEach(el => el.remove());

      const reminderNav = document.querySelector('.nav-item[data-target="reminders"]');
      if (reminderNav && !reminderNav.classList.contains("active")) {
        reminderNav.click();
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }

      toast(
        current.status === "pendiente"
          ? "Trabajo reprogramado."
          : current.status === "realizado"
            ? "Trabajo marcado como realizado."
            : "Trabajo marcado como no realizado."
      );
      return;
    }

    onSavedDetail?.();
    toast("Servicio actualizado.");
  });
}

/* ---------- Perfil V4 ---------- */

function renderProfilePreview() {
  if (!$("previewName")) return;

  const saved = getProfile();
  const profile = {
    ...saved,
    name: $("profileName")?.value.trim() || saved.name,
    trade: $("profileTrade")?.value.trim() || saved.trade,
    business: $("profileBusiness")?.value.trim() || saved.business,
    phone: $("profilePhone")?.value.trim() || saved.phone,
    email: $("profileEmail")?.value.trim() || saved.email,
    instagram: $("profileInstagram")?.value.trim() || saved.instagram
  };

  $("previewName").textContent = profile.name || "Tu nombre";
  $("previewTrade").textContent = profile.trade || "A qué te dedicás";
  $("profileInitials").textContent = getInitials(profile.name || profile.business || "TU");

  let businessEl = document.querySelector(".profile-business-preview");
  if (!businessEl) {
    businessEl = document.createElement("p");
    businessEl.className = "profile-business-preview";
    $("previewTrade").insertAdjacentElement("afterend", businessEl);
  }
  businessEl.textContent = profile.business || "";

  if (saved.logo) {
    $("profileLogo").src = saved.logo;
    $("profileLogo").classList.remove("hidden");
    $("profileInitials").classList.add("hidden");
  } else {
    $("profileLogo").classList.add("hidden");
    $("profileInitials").classList.remove("hidden");
  }

  const rows = [];
  if (profile.phone) rows.push(["Teléfono", profile.phone]);
  if (profile.email) rows.push(["Email", profile.email]);
  if (profile.instagram) rows.push(["Instagram", profile.instagram]);

  $("previewContacts").innerHTML = rows.length
    ? rows.map(([key, value]) => `<div class="contact-row"><span>${escapeHtml(key)}</span><span>${escapeHtml(value)}</span></div>`).join("")
    : `<div class="empty-state">Completá tus datos para ver tu tarjeta.</div>`;
}

async function handleLogo(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (file.size > 6_000_000) {
    toast("Elegí una imagen de menos de 6 MB.");
    event.target.value = "";
    return;
  }

  const dataUrl = await fileToDataUrl(file);
  openV4Cropper(dataUrl, event.target);
}

function openV4Cropper(dataUrl, inputEl) {
  const modal = document.createElement("div");
  modal.className = "v4-photo-modal";
  modal.innerHTML = `
    <div class="v4-photo-card">
      <div class="v4-photo-head">
        <div>
          <span class="eyebrow">Foto de perfil</span>
          <h2>Elegí qué parte querés mostrar</h2>
        </div>
        <button class="btn btn-quiet btn-fit" data-v4-crop-cancel>Cancelar</button>
      </div>

      <div class="v4-crop-stage">
        <canvas width="360" height="360"></canvas>
        <div class="v4-crop-ring"></div>
      </div>

      <label class="v4-zoom">
        Zoom
        <input type="range" min="1" max="3" step="0.01" value="1" data-v4-crop-zoom>
      </label>
      <p class="helper-text">Arrastrá la imagen hasta dejar visible la parte que querés.</p>
      <button class="btn btn-primary" data-v4-crop-save>Usar esta foto</button>
    </div>
  `;

  document.body.appendChild(modal);

  const canvas = modal.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const stage = modal.querySelector(".v4-crop-stage");
  const zoom = modal.querySelector("[data-v4-crop-zoom]");
  const image = new Image();

  const crop = {
    scale: 1,
    x: 0,
    y: 0,
    dragging: false,
    lastX: 0,
    lastY: 0
  };

  function draw() {
    ctx.clearRect(0, 0, 360, 360);
    const base = Math.max(360 / image.width, 360 / image.height);
    const scale = base * crop.scale;
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, (360 - w) / 2 + crop.x, (360 - h) / 2 + crop.y, w, h);
  }

  image.onload = draw;
  image.src = dataUrl;

  zoom.addEventListener("input", () => {
    crop.scale = Number(zoom.value);
    draw();
  });

  stage.addEventListener("pointerdown", event => {
    crop.dragging = true;
    crop.lastX = event.clientX;
    crop.lastY = event.clientY;
    stage.setPointerCapture?.(event.pointerId);
  });

  stage.addEventListener("pointermove", event => {
    if (!crop.dragging) return;
    const rect = stage.getBoundingClientRect();
    const factor = 360 / rect.width;
    crop.x += (event.clientX - crop.lastX) * factor;
    crop.y += (event.clientY - crop.lastY) * factor;
    crop.lastX = event.clientX;
    crop.lastY = event.clientY;
    draw();
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach(type => {
    stage.addEventListener(type, () => { crop.dragging = false; });
  });

  const cancel = () => {
    modal.remove();
    inputEl.value = "";
  };

  modal.querySelector("[data-v4-crop-cancel]").addEventListener("click", cancel);

  modal.querySelector("[data-v4-crop-save]").addEventListener("click", () => {
    // El marco visible va del 9% al 91% del canvas.
    const sourceStart = 360 * 0.09;
    const sourceSize = 360 * 0.82;
    const out = document.createElement("canvas");
    out.width = 512;
    out.height = 512;
    out.getContext("2d").drawImage(canvas, sourceStart, sourceStart, sourceSize, sourceSize, 0, 0, 512, 512);

    const profile = getProfile();
    profile.logo = out.toDataURL("image/jpeg", 0.88);
    localStorage.setItem("trabajo.profile.v3", JSON.stringify(profile));

    modal.remove();
    inputEl.value = "";
    renderProfilePreview();
    toast("Foto actualizada.");
  });
}
