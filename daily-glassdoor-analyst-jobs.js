#!/usr/bin/env node

/**
 * Daily Glassdoor analyst job scraper.
 *
 * Usage:
 *   node daily-glassdoor-analyst-jobs.js
 *
 * Requirements:
 *   1. `playwright-cli` is installed and available in PATH.
 *   2. You are already logged in to Glassdoor and Gmail in the playwright-cli browser session.
 *   3. If Gmail UI language changes, update the selectors in `buildEmailScript`.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const CONFIG = {
  outputMarkdown: path.join(__dirname, "system-analyst-jobs.md"),
  historyPath: path.join(__dirname, "system-analyst-jobs-history.json"),
  emailTo: "taoxiaoci411@gmail.com",
  emailSubject: "Glassdoor analyst matches - Full table with apply links",
  gmailCredentialsPath: path.join(__dirname, ".gmail-credentials.json"),
  gmailTokenPath: path.join(__dirname, ".gmail-token.json"),
  datePostedDays: 3,
  maxMainJobsPerCity: 250,
  maxSimilarJobsPerMainJob: 8,
  targetCities: ["Toronto", "Markham", "Mississauga", "Ottawa", "North York", "Vaughan", "Etobicoke"],
  cities: [
    {
      name: "Toronto",
      url: "https://www.glassdoor.ca/Job/toronto-analyst-jobs-SRCH_IL.0,7_IC2281069_KO8,15.htm?fromAge=3"
    },
    {
      name: "Markham",
      url: "https://www.glassdoor.ca/Job/markham-analyst-jobs-SRCH_IL.0,7_IC2280736_KO8,15.htm?fromAge=3"
    },
    {
      name: "Mississauga",
      url: "https://www.glassdoor.ca/Job/mississauga-analyst-jobs-SRCH_IL.0,11_IC2280741_KO12,19.htm?fromAge=3"
    },
    {
      name: "Ottawa",
      url: "https://www.glassdoor.ca/Job/ottawa-analyst-jobs-SRCH_IL.0,6_IC2286068_KO7,14.htm?fromAge=3"
    },
    {
      name: "North York",
      url: "https://www.glassdoor.ca/Job/north-york-analyst-jobs-SRCH_IL.0,10_IC4035434_KO11,18.htm?fromAge=3"
    },
    {
      name: "Vaughan",
      url: "https://www.glassdoor.ca/Job/vaughan-analyst-jobs-SRCH_IL.0,7_IC2284615_KO8,15.htm?fromAge=3"
    },
    {
      name: "Etobicoke",
      url: "https://www.glassdoor.ca/Job/etobicoke-analyst-jobs-SRCH_IL.0,9_IC2285483_KO10,17.htm?fromAge=3"
    }
  ]
};

const runPlaywrightCode = script => {
  const tempFile = path.join(os.tmpdir(), `glassdoor-flow-${Date.now()}-${Math.random().toString(16).slice(2)}.js`);
  fs.writeFileSync(tempFile, script, "utf8");

  try {
    if (process.platform === "win32") {
      const storageKey = `glassdoorFlow${Date.now()}${Math.random().toString(16).slice(2)}`;
      const encoded = Buffer.from(fs.readFileSync(tempFile, "utf8"), "utf8").toString("base64");
      const chunkSize = 3000;
      const psQuote = value => `'${String(value).replace(/'/g, "''")}'`;
      const jsString = value => `String.fromCharCode(${[...String(value)].map(char => char.charCodeAt(0)).join(",")})`;
      const runSmallCode = code => execFileSync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `playwright-cli run-code ${psQuote(code)}`
      ], {
        cwd: __dirname,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30 * 60 * 1000
      });

      const storageKeyLiteral = jsString(storageKey);
      runSmallCode(`async page => page.evaluate(() => localStorage.removeItem(${storageKeyLiteral}))`);

      for (let index = 0; index < encoded.length; index += chunkSize) {
        const chunk = encoded.slice(index, index + chunkSize);
        runSmallCode(`async page => page.evaluate(() => {
          const key = ${storageKeyLiteral};
          const value = ${jsString(chunk)};
          localStorage.setItem(key, (localStorage.getItem(key) || String()) + value);
        })`);
      }

      return runSmallCode(`async page => {
        const script = await page.evaluate(() => {
          const key = ${storageKeyLiteral};
          const encoded = localStorage.getItem(key);
          localStorage.removeItem(key);
          const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
          return new TextDecoder().decode(bytes);
        });
        const fn = eval(script);
        return await fn(page);
      }`);
    }

    return execFileSync("playwright-cli", ["run-code", script], {
          cwd: __dirname,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30 * 60 * 1000
        });
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
};

const parseRunCodeJson = raw => {
  const resultMatch = raw.match(/### Result\s*\r?\n([\s\S]*?)(?:\r?\n### |\r?\n?$)/);
  const trimmed = (resultMatch ? resultMatch[1] : raw).trim();

  try {
    return JSON.parse(JSON.parse(trimmed));
  } catch (error) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(`Unable to parse playwright-cli output:\n${trimmed.slice(0, 1000)}`);
    }
  }
};

const escapeHtml = value => String(value || "").replace(/[&<>"']/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
}[char]));

const escapeMarkdown = value => String(value || "")
  .replace(/\|/g, "\\|")
  .replace(/\r?\n/g, "<br>")
  .trim();

const formatDate = date => {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const getJobHistoryKey = job => {
  const jobLink = String(job.jobLink || "").trim();
  const jobId = jobLink.match(/[?&]jl=(\d+)/)?.[1];

  if (jobId) {
    return `glassdoor:${jobId}`;
  }

  return [
    job.title,
    job.company,
    job.location
  ].map(value => String(value || "").trim().toLowerCase()).join("|");
};

const loadJobHistory = config => {
  if (!fs.existsSync(config.historyPath)) {
    return { pushedJobs: {} };
  }

  try {
    const history = JSON.parse(fs.readFileSync(config.historyPath, "utf8"));
    return {
      pushedJobs: history.pushedJobs || {}
    };
  } catch {
    return { pushedJobs: {} };
  }
};

const getNewMatchesForEmail = (config, data) => {
  const history = loadJobHistory(config);
  const newMatches = data.matches.filter(job => !history.pushedJobs[getJobHistoryKey(job)]);

  return {
    history,
    emailData: {
      ...data,
      matchedCount: newMatches.length,
      matches: newMatches
    }
  };
};

const savePushedJobHistory = (config, history, jobs) => {
  const now = new Date().toISOString();

  jobs.forEach(job => {
    history.pushedJobs[getJobHistoryKey(job)] = {
      title: job.title,
      company: job.company,
      location: job.location,
      jobLink: job.jobLink,
      firstPushedAt: history.pushedJobs[getJobHistoryKey(job)]?.firstPushedAt || now,
      lastSeenAt: now
    };
  });

  fs.writeFileSync(config.historyPath, JSON.stringify(history, null, 2), "utf8");
};

const buildScrapeScript = config => `async page => {
  const config = ${JSON.stringify(config)};
  const titleExcludePattern = /\\b(senior|sr\\.?|student|intern|internship|co-?op|coop|trainee)\\b/i;
  const preferredPattern = /\\b(preferred|asset|nice to have|bonus|desirable|would be an asset)\\b/i;
  const strictMinimumPattern = /\\b(3\\s*\\+|3\\s*(?:or more|plus)|(?:minimum|at least)\\s+3|required.{0,50}\\b3\\s*(?:years?|yrs?)|must.{0,50}\\b3\\s*(?:years?|yrs?))\\b/i;
  const targetCityPattern = new RegExp("\\\\b(" + config.targetCities.map(city => city.replace(/\\s+/g, "\\\\s+")).join("|") + ")\\\\b", "i");
  const normalize = text => (text || "").replace(/\\s+/g, " ").trim();
  const isTargetLocation = location => targetCityPattern.test(location || "");
  const resumeSignals = [
    "business analysis", "business analyst", "agile", "sdlc", "requirements", "stakeholder",
    "functional specification", "technical requirement", "jira", "excel", "sql", "power bi",
    "uat", "test case", "process improvement", "six sigma", "compliance", "data analysis",
    "reporting", "dashboard", "ai", "machine learning"
  ];

  const closePopups = async targetPage => {
    await targetPage.evaluate(() => {
      document.querySelector("[data-test='edit-profile-insights-qualifications-modal-done']")?.click();
      document.querySelector("[data-test='job-alert-modal-close']")?.click();
      document.querySelector("[aria-label='Close notice']")?.click();
      document.querySelectorAll("dialog[open]").forEach(dialog => {
        const label = dialog.getAttribute("aria-label") || "";
        if (/qualifications|alert|notice/i.test(label)) {
          dialog.remove();
        }
      });
    }).catch(() => null);
  };

  const collectSearchJobs = async cityName => page.evaluate(city => {
    const parseCard = (card, index) => {
      const titleNode = card.querySelector("[data-test='job-title'], a[href*='job-listing']");
      const applyNode = card.querySelector("[data-test='job-link'], a[href*='partner/jobListing']");
      const locationNode = card.querySelector("[data-test='emp-location']");
      const salaryNode = card.querySelector("[data-test='detailSalary']");
      const ageNode = card.querySelector("[data-test='job-age']");
      const text = card.innerText || "";
      const title = titleNode?.innerText?.trim() || "";
      const location = locationNode?.innerText?.trim() || "";
      const salary = salaryNode?.innerText?.trim() || "";
      const posted = ageNode?.innerText?.trim() || "";
      const url = titleNode?.href || "";
      const applyUrl = applyNode?.href || url;
      const lines = text.split("\\n").map(line => line.trim()).filter(Boolean);
      const company = lines.find(line => {
        return line !== title
          && line !== location
          && line !== salary
          && line !== posted
          && !/^\\d+(\\.\\d+)?$/.test(line)
          && !/^easy apply$/i.test(line)
          && !/^\\$/.test(line);
      }) || "";

      return {
        sourceCity: city,
        sourceSection: card.closest("[data-test='related-jobs-list']") ? "similar" : "main",
        index: index + 1,
        company,
        title,
        location,
        salary,
        posted,
        url,
        applyUrl
      };
    };

    return [...document.querySelectorAll("li[data-test='jobListing']")]
      .map(parseCard)
      .filter(job => job.title && job.url && /analyst/i.test(job.title));
  }, cityName);

  const collectAllSearchJobs = async cityName => {
    const byUrl = new Map();
    let stableRounds = 0;
    let previousCount = 0;

    for (let round = 0; round < 25 && byUrl.size < config.maxMainJobsPerCity && stableRounds < 4; round += 1) {
      await closePopups(page);
      const jobs = await collectSearchJobs(cityName);
      jobs.forEach(job => {
        if (!byUrl.has(job.url)) {
          byUrl.set(job.url, { ...job, sourceSection: "main" });
        }
      });

      if (byUrl.size === previousCount) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
        previousCount = byUrl.size;
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => null);
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: /show more|load more/i }).click({ timeout: 1500 }).catch(() => null);
      await page.waitForTimeout(800);
    }

    return [...byUrl.values()].slice(0, config.maxMainJobsPerCity);
  };

  const collectSimilarJobs = async (detailPage, cityName) => detailPage.evaluate(city => {
    const cards = [
      ...document.querySelectorAll("[data-test='related-jobs-list'] li, [data-test='similar-jobs-list'] li, li[data-test='jobListing']")
    ];

    return cards.map((card, index) => {
      const titleNode = card.querySelector("[data-test='job-title'], a[href*='job-listing']");
      const applyNode = card.querySelector("[data-test='job-link'], a[href*='partner/jobListing']");
      const locationNode = card.querySelector("[data-test='emp-location']");
      const salaryNode = card.querySelector("[data-test='detailSalary']");
      const ageNode = card.querySelector("[data-test='job-age']");
      const text = card.innerText || "";
      const title = titleNode?.innerText?.trim() || "";
      const location = locationNode?.innerText?.trim() || "";
      const salary = salaryNode?.innerText?.trim() || "";
      const posted = ageNode?.innerText?.trim() || "";
      const url = titleNode?.href || "";
      const applyUrl = applyNode?.href || url;
      const lines = text.split("\\n").map(line => line.trim()).filter(Boolean);
      const company = lines.find(line => {
        return line !== title
          && line !== location
          && line !== salary
          && line !== posted
          && !/^\\d+(\\.\\d+)?$/.test(line)
          && !/^easy apply$/i.test(line)
          && !/^\\$/.test(line);
      }) || "";

      return {
        sourceCity: city,
        sourceSection: "similar",
        index: index + 1,
        company,
        title,
        location,
        salary,
        posted,
        url,
        applyUrl
      };
    }).filter(job => job.title && job.url && /analyst/i.test(job.title));
  }, cityName);

  const collectExperienceMentions = text => {
    const lines = text
      .split("\\n")
      .map(line => normalize(line))
      .filter(line => /year|yr|experience|requirement|qualification/i.test(line));
    const mentions = [];
    const addMention = (line, raw, min, max, kind) => {
      const preferredOnly = preferredPattern.test(line) && !strictMinimumPattern.test(line);
      let blocking = false;

      if (!preferredOnly) {
        if (kind === "range") {
          blocking = min >= 3;
        } else if (kind === "plus" || kind === "orMore") {
          blocking = min >= 3;
        } else {
          blocking = min > 3 || (min === 3 && strictMinimumPattern.test(line));
        }
      }

      mentions.push({ raw, min, max, kind, preferredOnly, blocking, line });
    };

    lines.forEach(line => {
      if (/less than\\s+3\\s+years?/i.test(line) || /up to\\s+3\\s+years?/i.test(line)) {
        return;
      }

      [
        ["range", /(\\d+)\\s*(?:-|–|to)\\s*(\\d+)\\s*\\+?\\s*(?:years?|yrs?)/gi],
        ["plus", /(\\d+)\\s*\\+\\s*(?:years?|yrs?)/gi],
        ["orMore", /(\\d+)\\s*(?:or more|plus)\\s*(?:years?|yrs?)/gi],
        ["exact", /(\\d+)\\s*(?:years?|yrs?)\\s+(?:of\\s+)?(?:relevant\\s+|related\\s+|professional\\s+|work\\s+|hands-on\\s+)?(?:experience|exp)/gi],
        ["field", /:\\s*(\\d+)\\s*(?:years?|yrs?)(?:\\s*\\((required|preferred)\\))?/gi],
        ["experienceFirst", /(?:experience|exp)[^.]{0,80}?(\\d+)\\s*\\+?\\s*(?:years?|yrs?)/gi]
      ].forEach(([kind, regex]) => {
        let match;
        while ((match = regex.exec(line))) {
          const min = Number(match[1]);
          const max = Number(match[2] && /^\\d+$/.test(match[2]) ? match[2] : match[1]);
          addMention(line, match[0], min, max, kind);
        }
      });
    });

    return [...new Map(mentions.map(item => [\`\${item.raw}|\${item.line}\`, item])).values()];
  };

  const getJobContent = text => {
    const lines = text.split("\\n").map(line => normalize(line)).filter(Boolean);
    const useful = lines.filter(line => {
      return /responsib|require|qualif|business|analysis|stakeholder|data|report|process|agile|sdlc|jira|excel|sql|power bi|uat|test|dashboard|workflow|compliance/i.test(line)
        && line.length > 35
        && line.length < 260;
    });
    return [...new Set(useful)].slice(0, 6);
  };

  const scoreJob = (job, detailText, experienceMentions) => {
    const lower = \`\${job.title}\\n\${job.company}\\n\${detailText}\`.toLowerCase();
    let score = 35;
    const reasons = [];
    const matchedSignals = resumeSignals.filter(signal => lower.includes(signal));
    score += Math.min(35, matchedSignals.length * 4);

    if (matchedSignals.length > 0) {
      reasons.push(\`Resume keyword match: \${matchedSignals.slice(0, 8).join(", ")}\`);
    }

    if (/business analyst|business systems analyst|system analyst|systems analyst/i.test(job.title)) {
      score += 15;
      reasons.push("Title aligns strongly with Business Analyst background");
    } else if (/data|report|financial|operations|process|research/i.test(job.title)) {
      score += 8;
      reasons.push("Title has adjacent analyst alignment");
    }

    if (isTargetLocation(job.location)) {
      score += 5;
      reasons.push("Location is in one of the target cities");
    }

    if (experienceMentions.some(mention => !mention.blocking && mention.min <= 2)) {
      score += 7;
      reasons.push("Experience range includes under 3 years");
    }

    if (/power bi|sql|excel|jira|uat|agile|sdlc/i.test(lower)) {
      score += 8;
      reasons.push("Tools/processes align with resume");
    }

    if (/accounting|payroll|tax|cyber|network|developer|engineer|sales/i.test(lower) && !/business analyst/i.test(job.title)) {
      score -= 10;
      reasons.push("Some domain mismatch risk");
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      reasons
    };
  };

  const detailPage = await page.context().newPage();
  const rawMatches = [];
  const rejected = [];
  const citySummaries = [];
  const similarCollectedFor = new Set();
  const similarQueue = [];
  const inspected = new Set();

  const inspectJob = async (job, options = {}) => {
    const collectSimilar = options.collectSimilar === true;

    if (!job.url || inspected.has(\`\${job.sourceSection}|\${job.url}\`)) {
      return;
    }
    inspected.add(\`\${job.sourceSection}|\${job.url}\`);

    if (titleExcludePattern.test(job.title)) {
      rejected.push({ ...job, reason: "excluded_by_title_role_keyword" });
      return;
    }

    if (job.sourceSection === "similar" && !isTargetLocation(job.location)) {
      rejected.push({ ...job, reason: "similar_outside_target_cities" });
      return;
    }

    try {
      await detailPage.goto(job.url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await detailPage.waitForTimeout(1300);
      await closePopups(detailPage);
      await detailPage.evaluate(() => window.stop()).catch(() => null);

      const showMore = detailPage.getByRole("button", { name: /^show more$/i }).first();
      if (await showMore.isVisible({ timeout: 700 }).catch(() => false)) {
        await showMore.click({ timeout: 2000 }).catch(() => null);
        await detailPage.waitForTimeout(300);
      }

      const detailText = await detailPage.locator("body").innerText({ timeout: 6000 });
      const experienceMentions = collectExperienceMentions(detailText);
      const blocking = experienceMentions.filter(mention => mention.blocking);
      if (blocking.length > 0) {
        rejected.push({ ...job, reason: "requires_strict_3_plus_years", blocking });
        return;
      }

      const { score, reasons } = scoreJob(job, detailText, experienceMentions);
      rawMatches.push({
        sourceCity: job.sourceCity,
        sourceSection: job.sourceSection,
        company: job.company,
        title: job.title,
        location: job.location,
        salary: job.salary,
        posted: job.posted,
        score,
        scoreReasons: reasons,
        experienceEvidence: experienceMentions.slice(0, 4).map(mention => mention.line),
        jobContent: getJobContent(detailText),
        jobLink: job.url,
        applyLink: job.applyUrl
      });

      if (collectSimilar && job.sourceSection === "main" && !similarCollectedFor.has(job.url)) {
        similarCollectedFor.add(job.url);
        const similarJobs = await collectSimilarJobs(detailPage, job.sourceCity);
        for (const similar of similarJobs.slice(0, config.maxSimilarJobsPerMainJob)) {
          similar.sourceSection = "similar";
          if (similar.url !== job.url) {
            similarQueue.push(similar);
          }
        }
      }
    } catch (error) {
      rejected.push({ ...job, reason: "inspection_failed", error: String(error.message || error).slice(0, 200) });
    }
  };

  for (const city of config.cities) {
    await page.goto(city.url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(3500);
    await closePopups(page);
    await page.evaluate(() => window.stop()).catch(() => null);

    const heading = await page.locator("[data-test='search-title']").innerText({ timeout: 3000 }).catch(() => "");
    const jobs = await collectAllSearchJobs(city.name);
    citySummaries.push({ city: city.name, heading, cardsFound: jobs.length, url: page.url() });

    for (const job of jobs) {
      await inspectJob(job, { collectSimilar: true });
    }
  }

  for (const similar of similarQueue) {
    await inspectJob(similar);
  }

  await detailPage.close().catch(() => null);

  const byJobLink = new Map();
  rawMatches.forEach(match => {
    const existing = byJobLink.get(match.jobLink);
    if (existing) {
      existing.foundIn.push(\`\${match.sourceCity} (\${match.sourceSection})\`);
      existing.score = Math.max(existing.score, match.score);
    } else {
      byJobLink.set(match.jobLink, {
        ...match,
        foundIn: [\`\${match.sourceCity} (\${match.sourceSection})\`]
      });
    }
  });

  const matches = [...byJobLink.values()].sort((a, b) => b.score - a.score);

  return JSON.stringify({
    extractedAt: new Date().toISOString(),
    targetCities: config.targetCities,
    citySummaries,
    matchedCount: matches.length,
    matches,
    rejectedSummary: rejected.reduce((summary, item) => {
      summary[item.reason] = (summary[item.reason] || 0) + 1;
      return summary;
    }, {})
  }, null, 2);
}`;

const buildMarkdown = data => {
  const generated = formatDate(new Date());
  const rows = data.matches.map((job, index) => {
    const fit = job.scoreReasons.join("; ");
    const experience = job.experienceEvidence.length > 0
      ? job.experienceEvidence.join("<br>")
      : "No explicit strict 3+ minimum requirement found in extracted text.";
    const content = job.jobContent.join("<br>");

    return [
      index + 1,
      job.score,
      escapeMarkdown(job.title),
      escapeMarkdown(job.company),
      escapeMarkdown(job.location || "N/A"),
      escapeMarkdown(job.foundIn.join(", ")),
      escapeMarkdown(job.posted || "N/A"),
      escapeMarkdown(job.salary || "N/A"),
      escapeMarkdown(fit),
      escapeMarkdown(experience),
      escapeMarkdown(content),
      escapeMarkdown(job.applyLink),
      escapeMarkdown(job.jobLink)
    ].join(" | ");
  });

  const cityLines = data.citySummaries.map(city => {
    const heading = city.heading || "No heading extracted";
    return `- ${city.city}: \`${heading}\`; ${city.cardsFound} analyst cards checked.`;
  });

  return `# Analyst Jobs (Glassdoor)

Generated: ${generated}

## Filters

- Keyword: \`analyst\`
- Date posted: \`Last ${CONFIG.datePostedDays} days\`
- Seniority level: \`All seniority levels\`
- Cities checked: \`${CONFIG.targetCities.join("`, `")}\`
- Included sections: main search results and Glassdoor \`Similar jobs\`
- Excluded by title only: \`senior\`, \`sr.\`, \`student\`, \`intern\`, \`internship\`, \`co-op\`, \`coop\`, \`trainee\`
- Experience rule: exclude only strict \`3+\` or higher requirements. Keep ranges like \`0-3\`, \`1-3\`, \`2-4\`, and \`2-5\`.
- Similar jobs city rule: \`Similar jobs\` must also be located in one of the target cities.

## Summary

- Unique matched jobs: **${data.matchedCount}**
- Rejected because of strict \`3+\` or higher experience requirements: **${data.rejectedSummary.requires_strict_3_plus_years || 0}**
- Rejected by title role keyword: **${data.rejectedSummary.excluded_by_title_role_keyword || 0}**
- Rejected similar jobs outside target cities: **${data.rejectedSummary.similar_outside_target_cities || 0}**
- Failed to inspect: **${data.rejectedSummary.inspection_failed || 0}**

## City Summary

${cityLines.join("\n")}

## Ranked Matches

| Rank | Score | Title | Company | Location | Found In | Posted | Salary | Fit Notes | Experience Evidence | Job Content | Apply Link | Job Link |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.map(row => `| ${row} |`).join("\n")}
`;
};

const buildEmailScript = (config, data) => {
  const rows = data.matches.map((job, index) => ({
    rank: index + 1,
    score: job.score,
    title: job.title,
    company: job.company,
    location: job.location || "N/A",
    foundIn: job.foundIn.join(", "),
    fit: job.scoreReasons.join("; "),
    experience: job.experienceEvidence.slice(0, 2).join(" | ") || "No strict 3+ minimum found",
    applyLink: job.applyLink,
    jobLink: job.jobLink
  }));

  return `async page => {
    const config = ${JSON.stringify(config)};
    const jobs = ${JSON.stringify(rows)};
    const escapeHtml = value => String(value || "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\\\"": "&quot;",
      "'": "&#39;"
    }[char]));
    const rows = jobs.map(job => \`
      <tr>
        <td>\${job.rank}</td>
        <td>\${job.score}</td>
        <td>\${escapeHtml(job.title)}</td>
        <td>\${escapeHtml(job.company)}</td>
        <td>\${escapeHtml(job.location)}</td>
        <td>\${escapeHtml(job.foundIn)}</td>
        <td>\${escapeHtml(job.fit)}</td>
        <td>\${escapeHtml(job.experience)}</td>
        <td><a href="\${escapeHtml(job.applyLink)}">Apply</a></td>
        <td><a href="\${escapeHtml(job.jobLink)}">Job</a></td>
      </tr>
    \`).join("");
    const html = \`
      <div>
        <p>Hi,</p>
        <p>Here is the full Glassdoor analyst job table from today's run. It includes all \${jobs.length} matched jobs, with matching points and application links.</p>
        <p><b>Filters:</b> Last \${config.datePostedDays} days, all seniority levels, cities \${config.targetCities.join(" / ")}. Similar jobs outside these cities were removed.</p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; vertical-align: top;">
          <thead>
            <tr style="background: #f2f2f2;">
              <th>Rank</th>
              <th>Score</th>
              <th>Title</th>
              <th>Company</th>
              <th>Location</th>
              <th>Found In</th>
              <th>Matching Points</th>
              <th>Experience Evidence</th>
              <th>Apply Link</th>
              <th>Job Link</th>
            </tr>
          </thead>
          <tbody>\${rows}</tbody>
        </table>
        <p>The same results are also saved in system-analyst-jobs.md.</p>
      </div>
    \`;
    await page.goto("https://mail.google.com/mail/u/0/#inbox", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: "写邮件" }).click();
    await page.waitForTimeout(1500);
    await page.getByLabel("发送至收件人").last().fill(config.emailTo);
    await page.keyboard.press("Enter");
    await page.getByLabel("主题").last().fill(config.emailSubject);
    const body = page.locator("[aria-label='邮件正文'][role='textbox']").last();
    await body.click();
    await page.evaluate(content => {
      const policy = window.trustedTypes?.createPolicy("cursorJobEmail", {
        createHTML: value => value
      });
      document.execCommand("insertHTML", false, policy ? policy.createHTML(content) : content);
    }, html);
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: /^发送/ }).last().click();
    await page.waitForTimeout(3000);
    return JSON.stringify({ sentTo: config.emailTo, subject: config.emailSubject, rows: jobs.length }, null, 2);
  }`;
};

const buildEmailHtml = (config, data) => {
  const rows = data.matches.map((job, index) => ({
    rank: index + 1,
    score: job.score,
    title: job.title,
    company: job.company,
    location: job.location || "N/A",
    foundIn: job.foundIn.join(", "),
    fit: job.scoreReasons.join("; "),
    experience: job.experienceEvidence.slice(0, 2).join(" | ") || "No strict 3+ minimum found",
    applyLink: job.applyLink,
    jobLink: job.jobLink
  }));

  const tableRows = rows.map(job => `
    <tr>
      <td>${job.rank}</td>
      <td>${job.score}</td>
      <td>${escapeHtml(job.title)}</td>
      <td>${escapeHtml(job.company)}</td>
      <td>${escapeHtml(job.location)}</td>
      <td>${escapeHtml(job.foundIn)}</td>
      <td>${escapeHtml(job.fit)}</td>
      <td>${escapeHtml(job.experience)}</td>
      <td><a href="${escapeHtml(job.applyLink)}">Apply</a></td>
      <td><a href="${escapeHtml(job.jobLink)}">Job</a></td>
    </tr>
  `).join("");

  return `
    <div>
      <p>Hi,</p>
      <p>Here is the full Glassdoor analyst job table from today's run. It includes all ${rows.length} matched jobs, with matching points and application links.</p>
      <p><b>Filters:</b> Last ${config.datePostedDays} days, all seniority levels, cities ${config.targetCities.join(" / ")}. Similar jobs outside these cities were removed.</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; vertical-align: top;">
        <thead>
          <tr style="background: #f2f2f2;">
            <th>Rank</th>
            <th>Score</th>
            <th>Title</th>
            <th>Company</th>
            <th>Location</th>
            <th>Found In</th>
            <th>Matching Points</th>
            <th>Experience Evidence</th>
            <th>Apply Link</th>
            <th>Job Link</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      <p>The same results are also saved in system-analyst-jobs.md.</p>
    </div>
  `;
};

const base64UrlEncode = value => Buffer.from(value, "utf8")
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/g, "");

const postForm = async (url, form) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(form).toString()
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Google OAuth request failed: ${response.status} ${text}`);
  }

  return JSON.parse(text);
};

const getGmailClientConfig = config => {
  if (!fs.existsSync(config.gmailCredentialsPath)) {
    throw new Error(
      `Missing Gmail credentials file: ${config.gmailCredentialsPath}\n`
      + "Create an OAuth Desktop Client in Google Cloud, download the JSON, and save it as .gmail-credentials.json."
    );
  }

  const credentials = JSON.parse(fs.readFileSync(config.gmailCredentialsPath, "utf8"));
  const client = credentials.installed || credentials.web;

  if (!client || !client.client_id || !client.client_secret) {
    throw new Error("Invalid .gmail-credentials.json. Expected an OAuth client JSON with installed.client_id/client_secret.");
  }

  return client;
};

const openBrowser = url => {
  try {
    if (process.platform === "win32") {
      execFileSync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Start-Process -FilePath $args[0]",
        url
      ], { stdio: "ignore" });
    } else {
      execFileSync("open", [url], { stdio: "ignore" });
    }
  } catch {
    console.log(`Open this URL to authorize Gmail:\n${url}`);
  }
};

const requestGmailAuthorization = async client => {
  const server = http.createServer();
  const codePromise = new Promise((resolve, reject) => {
    server.on("request", (req, res) => {
      const requestUrl = new URL(req.url, "http://127.0.0.1");
      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");

      if (error) {
        res.end("Authorization failed. You can close this tab.");
        reject(new Error(`Google authorization failed: ${error}`));
        return;
      }

      if (code) {
        res.end("Authorization complete. You can close this tab and return to Cursor.");
        resolve(code);
      }
    });
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.send");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log("Opening browser for Gmail authorization...");
  openBrowser(authUrl.toString());

  try {
    const code = await codePromise;
    return { code, redirectUri };
  } finally {
    server.close();
  }
};

const getGmailAccessToken = async config => {
  const client = getGmailClientConfig(config);
  let token = null;

  if (fs.existsSync(config.gmailTokenPath)) {
    token = JSON.parse(fs.readFileSync(config.gmailTokenPath, "utf8"));
  }

  if (token?.access_token && token.expiry_date && token.expiry_date > Date.now() + 60000) {
    return token.access_token;
  }

  if (token?.refresh_token) {
    const refreshed = await postForm("https://oauth2.googleapis.com/token", {
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token"
    });

    token = {
      ...token,
      access_token: refreshed.access_token,
      expiry_date: Date.now() + refreshed.expires_in * 1000
    };
    fs.writeFileSync(config.gmailTokenPath, JSON.stringify(token, null, 2), "utf8");
    return token.access_token;
  }

  const { code, redirectUri } = await requestGmailAuthorization(client);
  const granted = await postForm("https://oauth2.googleapis.com/token", {
    client_id: client.client_id,
    client_secret: client.client_secret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });

  token = {
    access_token: granted.access_token,
    refresh_token: granted.refresh_token,
    expiry_date: Date.now() + granted.expires_in * 1000
  };
  fs.writeFileSync(config.gmailTokenPath, JSON.stringify(token, null, 2), "utf8");
  return token.access_token;
};

const sendGmailApiEmail = async (config, data) => {
  if (data.matches.length === 0) {
    console.log("No new jobs to email. Skipping Gmail send.");
    return null;
  }

  const accessToken = await getGmailAccessToken(config);
  const html = buildEmailHtml(config, data);
  const mime = [
    `To: ${config.emailTo}`,
    `Subject: ${config.emailSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    html
  ].join("\r\n");

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      raw: base64UrlEncode(mime)
    })
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Gmail API send failed: ${response.status} ${text}`);
  }

  return JSON.parse(text);
};

const main = async () => {
  console.log("Starting Glassdoor scrape...");
  const scrapeOutput = runPlaywrightCode(buildScrapeScript(CONFIG));
  const data = parseRunCodeJson(scrapeOutput);

  fs.writeFileSync(CONFIG.outputMarkdown, buildMarkdown(data), "utf8");
  console.log(`Wrote Markdown: ${CONFIG.outputMarkdown}`);
  console.log(`Matched jobs: ${data.matchedCount}`);

  const { history, emailData } = getNewMatchesForEmail(CONFIG, data);
  console.log(`New jobs not previously emailed: ${emailData.matches.length}`);

  if (emailData.matches.length > 0) {
    console.log("Sending new jobs table via Gmail API...");
    await sendGmailApiEmail(CONFIG, emailData);
    savePushedJobHistory(CONFIG, history, emailData.matches);
    console.log(`Email sent to ${CONFIG.emailTo} with ${emailData.matches.length} new rows.`);
  } else {
    console.log("No new jobs to email.");
  }
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
