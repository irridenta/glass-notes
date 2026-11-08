/* Built-in content: covers, emoji, templates and the first-run welcome guide. */
(function () {
  const COVERS = {
    aurora:  { name: 'Aurora',  css: 'radial-gradient(120% 140% at 10% 0%, #7c5cff 0%, transparent 55%), radial-gradient(90% 120% at 100% 100%, #14b8a6 0%, transparent 55%), linear-gradient(120deg, #1b1240, #0b2a3a)' },
    nebula:  { name: 'Nebula',  css: 'radial-gradient(80% 120% at 80% 10%, #f472b6 0%, transparent 55%), radial-gradient(100% 140% at 0% 100%, #6d28d9 0%, transparent 60%), linear-gradient(140deg, #2a0f3d, #120b2b)' },
    lagoon:  { name: 'Lagoon',  css: 'radial-gradient(100% 140% at 20% 100%, #22d3ee 0%, transparent 55%), radial-gradient(80% 120% at 90% 0%, #3b82f6 0%, transparent 60%), linear-gradient(160deg, #06213a, #052c2c)' },
    ember:   { name: 'Ember',   css: 'radial-gradient(90% 140% at 0% 0%, #fb923c 0%, transparent 55%), radial-gradient(90% 120% at 100% 100%, #e11d48 0%, transparent 55%), linear-gradient(130deg, #3a1208, #2a0a1c)' },
    dusk:    { name: 'Dusk',    css: 'linear-gradient(180deg, #2b1a5a 0%, #6b3a8c 45%, #e3829b 80%, #f7c08a 100%)' },
    mint:    { name: 'Mint',    css: 'radial-gradient(100% 140% at 100% 0%, #a7f3d0 0%, transparent 50%), radial-gradient(90% 130% at 0% 100%, #0ea5e9 0%, transparent 55%), linear-gradient(120deg, #0b3b3a, #0b2240)' },
    prism:   { name: 'Prism',   css: 'conic-gradient(from 210deg at 60% 50%, #7c5cff, #22d3ee, #a3e635, #f472b6, #7c5cff)' },
    ink:     { name: 'Ink',     css: 'radial-gradient(60% 90% at 70% 30%, rgba(167,139,250,.35) 0%, transparent 60%), linear-gradient(180deg, #14131f, #0a0a12)' },
    sunrise: { name: 'Sunrise', css: 'linear-gradient(115deg, #ff9a8b 0%, #ff6a88 40%, #a855f7 100%)' },
    glacier: { name: 'Glacier', css: 'linear-gradient(135deg, #e0f2fe 0%, #93c5fd 35%, #6366f1 100%)' },
    forest:  { name: 'Forest',  css: 'radial-gradient(90% 140% at 10% 100%, #16a34a 0%, transparent 55%), radial-gradient(80% 120% at 90% 0%, #84cc16 0%, transparent 50%), linear-gradient(150deg, #052e1a, #0d2a14)' },
    mono:    { name: 'Graphite', css: 'linear-gradient(135deg, #2a2a35 0%, #121218 100%)' },
  };

  const EMOJI = {
    Popular: '📝 📌 ✨ 🌙 🔥 💡 🚀 🎯 📚 🧠 ❤️ ⭐ 🌱 🗂️ 📅 ✅ 🎨 🧩 💼 🏠 ☕ 🎧 📷 ✈️ 💬 🔖 🪐',
    Objects: '📓 📔 📒 📕 📗 📘 📙 📖 🗒️ 🗓️ 📊 📈 🧾 📎 🖊️ ✏️ 🖋️ 🔍 🔑 🧭 ⏳ ⏰ 💻 🖥️ 📱 🎬 🎮 🎸 🎹 🧪 🔬 🧰 🪴 🕯️ 🎁 💎',
    Nature: '🌸 🌺 🌻 🌷 🍀 🌿 🍃 🍂 🌵 🌊 🌈 ☀️ 🌤️ ⛅ 🌧️ ❄️ ⚡ 🌍 🌕 🌌 🦋 🐝 🐳 🦊 🐈 🐕 🦉',
    Food: '🍎 🍋 🍓 🍑 🥑 🥐 🍞 🧀 🍕 🍜 🍣 🥗 🍪 🍰 🍫 🍵 🧋 🍷',
    Symbols: '💜 💙 💚 💛 🧡 🤍 🖤 ✔️ ❌ ❗ ❓ 💯 ♾️ ⚙️ 🔒 🔔 🏷️ 🧷 🎉 🏆 🥇 👀 👋 🙌 💪 🤝 🙏',
  };

  let n = 0;
  const id = () => Date.now().toString(36) + (n++).toString(36) + Math.random().toString(36).slice(2, 7);
  const B = (type, html = '', extra = {}) => ({ id: id(), type, html, ...extra });

  const today = () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const TEMPLATES = [
    {
      key: 'blank', name: 'Empty page', icon: '📄', desc: 'A clean sheet. Type / to add anything.',
      make: () => ({ title: '', icon: '', cover: null, blocks: [B('p')] }),
    },
    {
      key: 'journal', name: 'Daily journal', icon: '🌙', desc: 'Gratitude, focus for the day and an evening look back.',
      make: () => ({
        title: today(), icon: '🌙', cover: 'dusk',
        blocks: [
          B('callout', 'How are you arriving today? Write a sentence before you plan anything.', { emoji: '☕' }),
          B('h2', 'Grateful for'), B('number'), B('number'), B('number'),
          B('h2', 'Today\'s focus'), B('todo'), B('todo'), B('todo'),
          B('h2', 'Notes'), B('p'),
          B('divider'),
          B('h3', 'Evening reflection'), B('quote', 'What went well, and what would I do differently?'), B('p'),
        ],
      }),
    },
    {
      key: 'meeting', name: 'Meeting notes', icon: '🗣️', desc: 'Agenda, decisions and action items with owners.',
      make: () => ({
        title: 'Meeting — ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), icon: '🗣️', cover: 'lagoon',
        blocks: [
          B('p', '<b>Date:</b> ' + today()), B('p', '<b>Attendees:</b> '),
          B('h2', 'Agenda'), B('bullet'), B('bullet'),
          B('h2', 'Discussion'), B('p'),
          B('h2', 'Decisions'), B('bullet'),
          B('h2', 'Action items'), B('todo', '<b>@Name</b> — '), B('todo', '<b>@Name</b> — '),
        ],
      }),
    },
    {
      key: 'project', name: 'Project plan', icon: '🚀', desc: 'Goal, milestones, open questions and risks.',
      make: () => ({
        title: 'New project', icon: '🚀', cover: 'aurora',
        blocks: [
          B('callout', '<b>Goal:</b> one sentence that says what “done” looks like.', { emoji: '🎯' }),
          B('h2', 'Why it matters'), B('p'),
          B('h2', 'Milestones'),
          B('todo', 'Kick-off and scope'), B('todo', 'First working version'), B('todo', 'Feedback round'), B('todo', 'Launch'),
          B('h2', 'Open questions'), B('bullet'),
          B('h2', 'Risks'), B('bullet'),
          B('divider'), B('h3', 'Links & resources'), B('bullet'),
        ],
      }),
    },
    {
      key: 'reading', name: 'Reading list', icon: '📚', desc: 'Books to read, in progress and finished — with notes.',
      make: () => ({
        title: 'Reading list', icon: '📚', cover: 'forest',
        blocks: [
          B('h2', 'Now reading'), B('todo', '<i>Title</i> — Author'),
          B('h2', 'Up next'), B('todo'), B('todo'),
          B('h2', 'Finished'), B('todo', '', { checked: true }),
          B('h2', 'Favourite quotes'), B('quote', ''),
        ],
      }),
    },
    {
      key: 'weekly', name: 'Weekly plan', icon: '🗓️', desc: 'Top priorities and a day-by-day outline.',
      make: () => ({
        title: 'Week of ' + new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' }), icon: '🗓️', cover: 'prism',
        blocks: [
          B('h2', 'Top 3 this week'), B('number'), B('number'), B('number'),
          ...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].flatMap((d) => [B('h3', d), B('todo')]),
          B('h3', 'Weekend'), B('p'),
        ],
      }),
    },
    {
      key: 'idea', name: 'Idea brief', icon: '💡', desc: 'Capture an idea, who it helps and the next step.',
      make: () => ({
        title: 'Idea', icon: '💡', cover: 'ember',
        blocks: [
          B('quote', 'The idea in one line.'),
          B('h3', 'Who is it for?'), B('p'),
          B('h3', 'What problem does it solve?'), B('p'),
          B('h3', 'Smallest version I could try'), B('bullet'),
          B('h3', 'Next step'), B('todo'),
        ],
      }),
    },
  ];

  function welcome() {
    const now = Date.now();
    const page = (o) => ({ id: id(), parentId: null, children: [], favorite: false, trashed: false, createdAt: now, updatedAt: now, font: 'sans', wide: false, ...o });

    const shortcuts = page({
      title: 'Keyboard shortcuts', icon: '⌨️', cover: 'ink',
      blocks: [
        B('p', 'Everything you can do with the mouse also has a shortcut.'),
        B('h2', 'Anywhere'),
        B('bullet', '<code>Ctrl K</code> — search pages and commands'),
        B('bullet', '<code>Ctrl N</code> — new page'),
        B('bullet', '<code>Ctrl \\</code> — show or hide the sidebar'),
        B('bullet', '<code>Ctrl Shift E</code> — export the page'),
        B('h2', 'While writing'),
        B('bullet', '<code>/</code> — insert a block (heading, to-do, quote, code…)'),
        B('bullet', '<code>Ctrl B</code>, <code>Ctrl I</code>, <code>Ctrl U</code> — bold, italic, underline'),
        B('bullet', '<code>Ctrl E</code> — inline code, <code>Ctrl Shift H</code> — highlight'),
        B('bullet', '<code>Ctrl K</code> with text selected — add a link'),
        B('bullet', '<code>Tab</code> / <code>Shift Tab</code> — indent or outdent list items'),
        B('bullet', '<code>Ctrl Shift ↑ / ↓</code> — move the current block'),
        B('bullet', '<code>Ctrl D</code> — duplicate the current block'),
        B('bullet', '<code>Ctrl Enter</code> — tick a to-do'),
        B('h2', 'Markdown shortcuts'),
        B('p', 'Type these at the start of an empty line, followed by a space:'),
        B('bullet', '<code>#</code> <code>##</code> <code>###</code> — headings'),
        B('bullet', '<code>-</code> or <code>*</code> — bullet list,  <code>1.</code> — numbered list'),
        B('bullet', '<code>[]</code> — to-do,  <code>&gt;</code> — quote,  <code>!</code> — callout'),
        B('bullet', '<code>```</code> — code block,  <code>---</code> — divider'),
      ],
    });

    const sample = page({
      title: 'A tidy week', icon: '🌿', cover: 'mint',
      blocks: [
        B('callout', 'This is an example page. Tick things off, edit anything, or delete it from the sidebar.', { emoji: '🌱' }),
        B('h2', 'Priorities'),
        B('todo', 'Try the <b>/</b> menu on an empty line', { checked: true }),
        B('todo', 'Give this page a new cover'),
        B('todo', 'Export a page as PDF from <b>Share</b>'),
        B('h2', 'Notes'),
        B('p', 'Select any text to <mark class="hl-violet">highlight</mark>, make it <b>bold</b>, <i>italic</i> or turn it into a link.'),
        B('quote', 'Small, steady steps beat occasional heroics.'),
        B('code', 'const plan = ["write", "rest", "repeat"];'),
      ],
    });

    const guide = page({
      title: 'Welcome to Glass Notes', icon: '✨', cover: 'aurora', favorite: true,
      blocks: [
        B('p', 'A calm place for notes, plans and ideas. Everything is saved on this computer automatically — there is no account and nothing leaves your machine unless you share it.'),
        B('callout', 'Click anywhere below and start typing. Press <b>/</b> on an empty line to add headings, to-dos, quotes, code, images and more.', { emoji: '👋' }),
        B('h2', 'The basics'),
        B('todo', 'Hover the title to <b>add an icon or cover</b>'),
        B('todo', 'Drag the <b>⋮⋮</b> handle on the left of a block to move it'),
        B('todo', 'Create a page inside this one with <b>+</b> next to it in the sidebar'),
        B('todo', 'Star a page to pin it under <b>Favorites</b>'),
        B('h2', 'Sharing a page'),
        B('p', 'Press <b>Share</b> in the top-right corner:'),
        B('bullet', '<b>Web page</b> — a single .html file anyone can open in a browser. Images and fonts are included.'),
        B('bullet', '<b>PDF</b> — a clean, print-ready document.'),
        B('h2', 'Where things live'),
        B('p', 'Your notes are stored in one file on this computer. Open <b>Settings</b> to see where, and to back it up.'),
        B('divider'),
        B('p', 'Explore the pages tucked inside this one ↓'),
      ],
    });
    shortcuts.parentId = guide.id;
    sample.parentId = guide.id;
    guide.children = [shortcuts.id, sample.id];
    return [guide, shortcuts, sample];
  }

  window.GN = { COVERS, EMOJI, TEMPLATES, welcome, uid: id, B };
})();
