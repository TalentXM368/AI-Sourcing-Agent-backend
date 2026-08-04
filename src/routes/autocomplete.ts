import { Router, Request, Response } from 'express'
import { pool } from '../db/index.js'

export const autocompleteRouter = Router()

// ─── Types ────────────────────────────────────────────────────

interface Suggestion {
  value: string
  label: string
  sublabel?: string   // e.g. "Programming Languages" for skills, "United Kingdom" for locations
  count: number
  type: 'skill' | 'location' | 'job_title'
}

// ─── In-Memory Taxonomy (LinkedIn-style) ──────────────────────
// Curated lists like LinkedIn's skill/location/title taxonomy.
// Combined with DB frequency for popularity ranking.

const SKILL_TAXONOMY: Record<string, string[]> = {
  'Programming Languages': [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP',
    'Swift', 'Kotlin', 'Scala', 'R', 'MATLAB', 'SQL', 'HTML', 'CSS', 'Sass', 'SCSS',
    'Dart', 'Lua', 'Haskell', 'Elixir', 'Clojure', 'F#', 'Perl', 'PowerShell', 'Bash',
    'Shell Scripting', 'Objective-C', 'Visual Basic', 'Assembly', 'Groovy', 'Fortran',
    'COBOL', 'Julia', 'GraphQL', 'Solidity', 'GML', 'Zig', 'Odin', 'Nim', 'Crystal',
    'Hack', 'Apex', 'VBA', 'ABAP', 'PL/SQL', 'T-SQL', 'RPG', 'Delphi', 'Pascal',
    'ActionScript', 'ColdFusion', 'Erlang', 'OCaml', 'Racket', 'Scheme', 'Lisp',
    'Prolog', 'Logo', 'Smalltalk', 'Ada', 'Modula-2', 'Simula', 'CLIPS',
  ],
  'Frontend Frameworks': [
    'React', 'Vue.js', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt.js', 'Remix', 'Astro',
    'SvelteKit', 'SolidJS', 'Qwik', 'Gatsby', 'jQuery', 'Bootstrap', 'Tailwind CSS', 'Tailwind',
    'Material UI', 'MUI', 'Chakra UI', 'Ant Design', 'shadcn/ui', 'Styled Components',
    'Emotion', 'Storybook', 'Framer Motion', 'Three.js', 'D3.js', 'Chart.js',
    'Redux', 'Zustand', 'MobX', 'Recoil', 'Jotai', 'XState', 'TanStack Query',
    'React Query', 'React Router', 'Vite', 'Webpack', 'esbuild', 'Rollup', 'Parcel', 'Turbopack',
    'Lit', 'Alpine.js', 'HTMX', 'Preact', 'Inferno', 'Mithril', 'Ember.js', 'Backbone.js',
    'Meteor', 'Marko', 'Polymer', 'Web Components', 'Shadow DOM', 'Custom Elements',
    'Canvas API', 'WebGL', 'WebAssembly', 'WASM', 'Web Workers', 'Service Workers',
    'PWA', 'IndexedDB', 'LocalStorage', 'Session Storage',
  ],
  'Backend Frameworks': [
    'Node.js', 'Express.js', 'Fastify', 'NestJS', 'Koa.js', 'Hapi',
    'Django', 'Flask', 'FastAPI', 'Starlette', 'Tornado', 'Celery',
    'Spring Boot', 'Spring MVC', 'Spring Cloud', 'Hibernate', 'Quarkus', 'Micronaut',
    'Ruby on Rails', 'Sinatra', 'Hanami',
    'Laravel', 'Symfony', 'CodeIgniter', 'CakePHP',
    'ASP.NET Core', 'ASP.NET MVC', 'Entity Framework', 'Blazor', '.NET',
    'Go Fiber', 'Gin', 'Echo', 'Chi', 'gorilla/mux',
    'Actix Web', 'Rocket', 'Axum', 'Warp',
    'Phoenix', 'Elixir/Phoenix',
    'Rust Actix', 'Tokio',
    'Caddy', 'Traefik',
  ],
  'AI & Machine Learning': [
    'Machine Learning', 'Deep Learning', 'Natural Language Processing', 'NLP',
    'Computer Vision', 'Reinforcement Learning', 'Generative AI', 'LLMs',
    'Prompt Engineering', 'RAG', 'Fine-tuning', 'Transfer Learning',
    'Neural Networks', 'CNNs', 'RNNs', 'Transformers', 'GANs', 'VAEs', 'Diffusion Models',
    'TensorFlow', 'PyTorch', 'Keras', 'Scikit-learn', 'Hugging Face', 'HuggingFace',
    'OpenAI API', 'LangChain', 'LlamaIndex', 'Vector Databases', 'Pinecone', 'Weaviate', 'Milvus',
    'Embeddings', 'Semantic Search', 'Multi-modal AI', 'AI Agents',
    'Multi-agent Systems', 'MLOps', 'Data Science', 'Statistical Analysis',
    'Feature Engineering', 'A/B Testing', 'Time Series Analysis',
    'XGBoost', 'LightGBM', 'CatBoost', 'Prophet',
    'Pandas', 'NumPy', 'SciPy', 'Matplotlib', 'Seaborn', 'Plotly',
    'Jupyter', 'MLflow', 'Weights & Biases', 'DVC',
    'spaCy', 'NLTK', 'Gensim', 'BERT', 'GPT', 'Claude', 'Gemini', 'LLaMA', 'Mistral',
    'Stable Diffusion', 'Midjourney', 'DALL-E', 'Whisper', 'TTS',
    'ONNX', 'TensorRT', 'TorchServe', 'Triton', 'BentoML',
    'Ray', 'Dask', 'Apache Spark', 'Kafka Streams', 'Flink',
    'Apache Airflow', 'Prefect', 'Dagster',
    'Anomaly Detection', 'Recommendation Systems', 'Search Ranking',
    'RAG Pipeline', 'Agentic AI', 'Function Calling', 'Tool Use',
  ],
  'Cloud & DevOps': [
    'AWS', 'Amazon Web Services', 'Microsoft Azure', 'Google Cloud Platform', 'GCP',
    'Terraform', 'Pulumi', 'CloudFormation', 'Ansible', 'Chef', 'Puppet', 'SaltStack',
    'Docker', 'Kubernetes', 'Helm', 'Kustomize', 'Podman', 'containerd', 'Docker Compose',
    'Jenkins', 'GitHub Actions', 'GitLab CI/CD', 'CircleCI', 'Travis CI', 'ArgoCD', 'FluxCD',
    'Prometheus', 'Grafana', 'Datadog', 'New Relic', 'Splunk', 'ELK Stack', 'Loki',
    'Nginx', 'Apache', 'HAProxy', 'Envoy', 'Istio', 'Caddy', 'Traefik',
    'Linux', 'Ubuntu', 'CentOS', 'RHEL', 'Alpine', 'Debian', 'Fedora',
    'Packer', 'Vagrant', 'VirtualBox', 'VMware',
    'Sentry', 'PagerDuty', 'OpsGenie', 'VictorOps',
    'Vercel', 'Netlify', 'Heroku', 'DigitalOcean', 'Fly.io', 'Railway', 'Render',
    'Cloudflare', 'Fastly', 'Akamai', 'AWS CloudFront',
    'Lambda', 'ECS', 'EKS', 'Fargate', 'S3', 'RDS', 'EC2', 'CloudFront',
    'Route 53', 'API Gateway', 'SQS', 'SNS', 'Step Functions', 'EventBridge',
    'Cloud Functions', 'Cloud Run', 'App Engine', 'BigQuery', 'Dataflow', 'Pub/Sub',
    'Azure DevOps', 'Azure Functions', 'Azure Cosmos DB', 'Azure ML', 'Azure AD',
    'CI/CD', 'DevOps', 'GitOps', 'Infrastructure as Code', 'Containerization',
    'Orchestration', 'Serverless', 'Site Reliability Engineering', 'SRE',
    'Observability', 'Chaos Engineering', 'Zero Trust', 'Service Mesh',
    'AWS Lambda', 'AWS Lambda@Edge', 'AWS Step Functions', 'AWS Glue', 'AWS EMR',
    'Google BigQuery', 'Google Dataflow', 'Google Pub/Sub', 'Google Firestore',
    'Azure Kubernetes Service', 'Azure DevOps Pipelines', 'Azure Blob Storage',
    'NATS', 'RabbitMQ', 'Apache Kafka', 'Apache Pulsar', 'Redis Streams',
  ],
  'Databases': [
    'PostgreSQL', 'MySQL', 'MariaDB', 'SQL Server', 'Oracle DB', 'SQLite',
    'MongoDB', 'Redis', 'Elasticsearch', 'DynamoDB', 'Cassandra', 'CouchDB',
    'Neo4j', 'InfluxDB', 'TimescaleDB', 'CockroachDB', 'Firebase Firestore',
    'Supabase', 'PlanetScale', 'FaunaDB', 'ArangoDB', 'RethinkDB',
    'Prisma', 'TypeORM', 'Sequelize', 'Knex.js', 'Drizzle',
    'Mongoose', 'ioredis', 'pg', 'psycopg2',
    'GraphQL', 'gRPC', 'REST API', 'WebSocket',
    'ClickHouse', 'Snowflake', 'Databricks', 'BigQuery', 'Redshift',
    'Memcached', 'Riak', 'Amazon Neptune', 'JanusGraph', 'Dgraph',
    'Pinecone', 'Milvus', 'Weaviate', 'Qdrant', 'Chroma', 'LanceDB',
    'NoSQL', 'SQL', 'OLAP', 'OLTP', 'Data Warehouse', 'Data Lake',
    'Database Design', 'Query Optimization', 'Database Administration', 'DBA',
  ],
  'Mobile Development': [
    'React Native', 'Flutter', 'Swift', 'SwiftUI', 'Kotlin', 'Jetpack Compose',
    'Xamarin', '.NET MAUI', 'Ionic', 'Cordova', 'Capacitor', 'Expo',
    'Objective-C', 'UIKit', 'Android SDK', 'iOS Development', 'Android Development',
    'Mobile App Development', 'Progressive Web Apps', 'PWA',
    'SwiftUI', 'Combine', 'Core Data', 'Core ML', 'ARKit', 'RealityKit',
    'Kotlin Multiplatform', 'KMP',
    'Realm', 'SQLite', 'Hive', 'ObjectBox',
    'Firebase', 'Push Notifications', 'In-App Purchases', 'App Store Optimization',
    'Responsive Design', 'Adaptive Layout',
  ],
  'Developer Tools': [
    'Git', 'GitHub', 'GitLab', 'Bitbucket', 'Jira', 'Confluence',
    'Slack', 'Notion', 'Figma', 'Postman', 'Swagger', 'Insomnia',
    'VS Code', 'Visual Studio', 'IntelliJ IDEA', 'Vim', 'Neovim', 'Emacs',
    'Chrome DevTools', 'Selenium', 'Playwright', 'Cypress', 'Puppeteer',
    'npm', 'Yarn', 'pnpm', 'Bun', 'Deno',
    'Maven', 'Gradle', 'NuGet', 'pip', 'Conda',
    'Trello', 'Asana', 'Monday.com', 'Linear',
    'Miro', 'Lucidchart',
    'Cursor', 'Windsurf', 'Copilot', 'GitHub Copilot', 'Cody', 'Tabnine',
    'ESLint', 'Prettier', 'Biome', 'oxlint',
    'TurboRepo', 'Nx', 'Lerna', 'Changesets',
    'Docker Desktop', 'Portainer', 'Lens', 'k9s',
    'Postman', 'Insomnia', 'Bruno', 'Hoppscotch',
  ],
  'Testing': [
    'Unit Testing', 'Integration Testing', 'E2E Testing', 'End-to-End Testing',
    'Jest', 'Vitest', 'Mocha', 'Chai', 'Jasmine', 'Karma',
    'Playwright', 'Cypress', 'Selenium', 'Puppeteer', 'TestCafe', 'WebdriverIO',
    'React Testing Library', 'Enzyme', 'Storybook',
    'pytest', 'unittest', 'JMeter', 'Gatling', 'k6', 'Locust',
    'xUnit', 'NUnit', 'MSTest', 'Moq', 'NSubstitute',
    'JBehave', 'Cucumber', 'SpecFlow', 'Gherkin',
    'Load Testing', 'Stress Testing', 'Performance Testing', 'Security Testing',
    'Penetration Testing', 'OWASP', 'SAST', 'DAST', 'Snyk', 'Dependabot',
    'Test Automation', 'Test Coverage', 'Code Coverage',
    'Mutation Testing', 'Fuzz Testing', 'Chaos Testing',
  ],
  'Security': [
    'Cybersecurity', 'Information Security', 'Application Security', 'AppSec',
    'Network Security', 'Cloud Security', 'DevSecOps',
    'OWASP Top 10', 'Penetration Testing', 'Ethical Hacking',
    'SIEM', 'SOC', 'Incident Response', 'Forensics',
    'Firewall', 'IDS/IPS', 'WAF', 'DDoS Protection',
    'OAuth 2.0', 'SAML', 'OIDC', 'LDAP', 'Active Directory',
    'PKI', 'TLS/SSL', 'Certificate Management',
    'Vulnerability Assessment', 'Threat Modeling', 'Risk Assessment',
    'Compliance', 'SOC 2', 'ISO 27001', 'GDPR', 'HIPAA', 'PCI DSS',
    'Cryptography', 'Encryption', 'Hashing', 'Key Management',
    'Bug Bounty', 'Red Teaming', 'Blue Teaming', 'Purple Teaming',
  ],
  'Data Engineering': [
    'ETL', 'ELT', 'Data Pipeline', 'Data Integration', 'Data Migration',
    'Apache Spark', 'Apache Airflow', 'Apache Kafka', 'Apache Flink', 'Apache Beam',
    'Apache NiFi', 'Apache Superset', 'Apache Hive', 'Apache Pig',
    'dbt', 'Fivetran', 'Stitch', 'Airbyte', 'Meltano',
    'Snowflake', 'Databricks', 'Delta Lake', 'Apache Iceberg', 'Apache Hudi',
    'Data Modeling', 'Data Governance', 'Data Quality', 'Data Catalog',
    'Data Warehouse', 'Data Lake', 'Data Mesh', 'Data Fabric',
    'Streaming', 'Batch Processing', 'Real-time Processing',
    'Informatica', 'Talend', 'SSIS', 'DataStage',
    'Great Expectations', 'Monte Carlo', 'Soda',
  ],
  'Concepts & Methodologies': [
    'REST API', 'Microservices', 'Event-Driven Architecture', 'CQRS',
    'Event Sourcing', 'Domain-Driven Design', 'DDD', 'SOLID Principles',
    'Design Patterns', 'Data Structures', 'Algorithms', 'Object-Oriented Programming',
    'Functional Programming', 'Reactive Programming', 'Concurrent Programming',
    'Agile', 'Scrum', 'Kanban', 'Lean', 'SAFe',
    'TDD', 'BDD', 'Unit Testing', 'Integration Testing', 'E2E Testing',
    'Test-Driven Development', 'Pair Programming', 'Mob Programming',
    'Code Review', 'Refactoring', 'Technical Debt',
    'OAuth', 'JWT', 'SSO', 'RBAC', 'ABAC',
    'WebSocket', 'Message Queues', 'Event Streaming', 'Pub/Sub',
    'Caching', 'Rate Limiting', 'Load Balancing',
    'Monorepo', 'Polyrepo', 'Feature Flags', 'Canary Deployments',
    'Blue-Green Deployments', 'Multi-tenancy',
    'SaaS', 'PaaS', 'IaaS',
    'Data Structures & Algorithms', 'System Design', 'Scalability',
    'High Availability', 'Disaster Recovery',
    'API Design', 'API Versioning', 'Backward Compatibility',
    '12-Factor App', 'Clean Architecture', 'Hexagonal Architecture',
    'Onion Architecture', 'Server-Side Rendering', 'SSR',
    'Static Site Generation', 'SSG', 'ISR', 'Edge Computing',
    'Web3', 'Blockchain', 'Smart Contracts', 'DeFi', 'NFT',
    'Low-code', 'No-code', 'Rapid Application Development',
  ],
  'Healthcare': [
    'HIPAA', 'EHR', 'Epic', 'Cerner', 'Clinical Trials', 'Patient Care',
    'Medical Records', 'ICD-10', 'CPT Coding', 'Medical Imaging',
    'Radiology', 'Nursing', 'Emergency Medicine', 'Internal Medicine',
    'Public Health', 'Epidemiology', 'Biostatistics', 'Health Informatics',
    'BLS', 'ACLS', 'PALS', 'CPR',
    'HL7', 'FHIR', 'DICOM', 'Interoperability',
    'Telehealth', 'Remote Patient Monitoring', 'Digital Health',
    'Pharmacovigilance', 'Drug Discovery', 'Clinical Decision Support',
    'Healthcare Analytics', 'Population Health Management',
  ],
  'Finance & Accounting': [
    'Financial Modeling', 'Valuation', 'DCF', 'LBO', 'WACC',
    'Risk Analysis', 'Compliance', 'AML', 'KYC', 'SOX', 'Audit',
    'Portfolio Management', 'Asset Allocation', 'Equities', 'Fixed Income',
    'Derivatives', 'Credit Analysis', 'Underwriting', 'Actuarial',
    'CFA', 'CPA', 'FRM', 'Bloomberg Terminal',
    'Investment Banking', 'Wealth Management', 'Hedge Fund',
    'Private Equity', 'Venture Capital', 'Quantitative Analysis',
    'FinTech', 'Payments', 'Banking', 'Insurance', 'RegTech',
    'Algo Trading', 'High-Frequency Trading', 'Market Making',
    'Embedded Finance', 'BNPL', 'Open Banking', 'PSD2',
  ],
  'Design & Creative': [
    'UI/UX Design', 'Figma', 'Sketch', 'Adobe XD', 'InVision',
    'Photoshop', 'Illustrator', 'InDesign', 'After Effects', 'Premiere Pro',
    'Blender', 'Cinema 4D', 'Maya', 'ZBrush', 'Procreate', 'Canva',
    'Wireframing', 'Prototyping', 'Design Systems', 'Typography',
    'Color Theory', 'User Research', 'Usability Testing',
    'Accessibility', 'WCAG', 'Motion Graphics', 'Brand Identity',
    'Graphic Design', 'Video Editing', '3D Modeling', 'Animation',
    'Interaction Design', 'Information Architecture', 'Service Design',
    'Product Design', 'Visual Design', 'Design Thinking',
    'Adobe Creative Suite', 'Affinity Designer', 'CorelDRAW',
  ],
  'Project & Product Management': [
    'Project Management', 'Product Management', 'Program Management',
    'Agile Project Management', 'Scrum Master', 'Product Owner',
    'Roadmap Planning', 'Sprint Planning', 'Backlog Grooming',
    'Stakeholder Management', 'Risk Management', 'Change Management',
    'Requirements Gathering', 'User Stories', 'Acceptance Criteria',
    'OKRs', 'KPIs', 'Metrics', 'Data-Driven Decisions',
    'Go-to-Market', 'Market Research', 'Competitive Analysis',
    'P&L Management', 'Budget Management', 'Resource Planning',
    'Waterfall', 'Hybrid', 'PMO', 'Prince2', 'PMP', 'CAPM',
  ],
  'Engineering': [
    'AutoCAD', 'SolidWorks', 'CATIA', 'Revit', 'Fusion 360',
    'ANSYS', 'Simulink', 'LabVIEW',
    'Six Sigma', 'Lean Manufacturing', 'ISO 9001', 'ISO 14001',
    'GD&T', 'CNC', 'PLC', 'SCADA',
    'Quality Assurance', 'Root Cause Analysis', 'FMEA',
    'Kaizen', '5S', 'Kanban',
    'Embedded Systems', 'IoT', 'RTOS', 'Firmware Development',
    'PCB Design', 'Altium', 'KiCad', 'Eagle',
    'MATLAB', 'Simulink', 'Model-Based Design',
    'Robotics', 'ROS', 'Computer-Aided Engineering',
  ],
  'Sales & Marketing': [
    'Salesforce', 'HubSpot', 'Marketo', 'Pardot', 'Google Analytics',
    'SEO', 'SEM', 'Google Ads', 'Facebook Ads', 'LinkedIn Ads',
    'Content Marketing', 'Email Marketing', 'Marketing Automation',
    'CRM', 'Lead Generation', 'ABM', 'Account-Based Marketing',
    'Copywriting', 'A/B Testing', 'Conversion Optimization',
    'Growth Hacking', 'Product-Led Growth', 'PLG',
    'Social Media Marketing', 'Influencer Marketing', 'Affiliate Marketing',
    'Demand Generation', 'Brand Marketing', 'Performance Marketing',
    'Marketing Analytics', 'Attribution', 'CAC', 'LTV',
    'Sales Operations', 'Revenue Operations', 'RevOps',
  ],
  'Soft Skills': [
    'Communication', 'Leadership', 'Team Management', 'Mentoring',
    'Problem Solving', 'Critical Thinking', 'Time Management',
    'Project Management', 'Stakeholder Management', 'Negotiation',
    'Public Speaking', 'Technical Writing', 'Cross-functional Collaboration',
    'Adaptability', 'Attention to Detail', 'Analytical Thinking',
    'Emotional Intelligence', 'Conflict Resolution', 'Decision Making',
    'Strategic Thinking', 'Innovation', 'Creativity',
    'Delegation', 'Coaching', 'Building Teams',
    'Executive Presence', 'Storytelling', 'Persuasion',
  ],
}

// Build flat list from taxonomy
const ALL_SKILLS: Array<{ value: string; category: string }> = []
for (const [category, skills] of Object.entries(SKILL_TAXONOMY)) {
  for (const skill of skills) {
    ALL_SKILLS.push({ value: skill, category })
  }
}

const LOCATION_TAXONOMY = [
  // Countries
  'United States', 'India', 'United Kingdom', 'Canada', 'Germany', 'France',
  'Netherlands', 'Australia', 'Brazil', 'Japan', 'Singapore', 'Ireland',
  'Israel', 'Sweden', 'Switzerland', 'Norway', 'Denmark', 'Finland',
  'Spain', 'Italy', 'Portugal', 'Poland', 'Czech Republic', 'Romania',
  'Mexico', 'Argentina', 'Colombia', 'Chile', 'Peru', 'Turkey',
  'South Korea', 'China', 'Taiwan', 'Vietnam', 'Thailand', 'Indonesia',
  'Philippines', 'Malaysia', 'New Zealand', 'South Africa', 'Nigeria',
  'Kenya', 'Egypt', 'UAE', 'Saudi Arabia', 'Qatar', 'Jordan',
  // US States / Metro Areas
  'San Francisco, CA', 'New York, NY', 'Seattle, WA', 'Austin, TX',
  'Los Angeles, CA', 'Chicago, IL', 'Boston, MA', 'Denver, CO',
  'Portland, OR', 'Atlanta, GA', 'Miami, FL', 'Dallas, TX',
  'Houston, TX', 'Phoenix, AZ', 'San Diego, CA', 'Minneapolis, MN',
  'Washington, DC', 'Raleigh, NC', 'Charlotte, NC', 'Salt Lake City, UT',
  'Pittsburgh, PA', 'Columbus, OH', 'Indianapolis, IN', 'Detroit, MI',
  'Nashville, TN', 'Tampa, FL', 'Orlando, FL', 'Sacramento, CA',
  'Remote', 'Hybrid', 'On-site',
  // India metros
  'Bangalore, India', 'Mumbai, India', 'Delhi, India', 'Hyderabad, India',
  'Pune, India', 'Chennai, India', 'Kolkata, India', 'Ahmedabad, India',
  'Gurgaon, India', 'Noida, India', 'Jaipur, India', 'Kochi, India',
  // UK
  'London, UK', 'Manchester, UK', 'Edinburgh, UK', 'Bristol, UK',
  'Cambridge, UK', 'Oxford, UK', 'Birmingham, UK', 'Leeds, UK',
  // Canada
  'Toronto, Canada', 'Vancouver, Canada', 'Montreal, Canada', 'Ottawa, Canada',
  'Calgary, Canada', 'Waterloo, Canada',
  // Germany
  'Berlin, Germany', 'Munich, Germany', 'Hamburg, Germany', 'Frankfurt, Germany',
  'Cologne, Germany', 'Stuttgart, Germany',
  // Other
  'Amsterdam, Netherlands', 'Dublin, Ireland', 'Barcelona, Spain',
  'Paris, France', 'Zurich, Switzerland', 'Stockholm, Sweden',
  'Copenhagen, Denmark', 'Helsinki, Finland', 'Lisbon, Portugal',
  'Tel Aviv, Israel', 'Singapore, Singapore', 'Tokyo, Japan',
  'Sydney, Australia', 'Melbourne, Australia',
  'São Paulo, Brazil', 'Mexico City, Mexico',
]

// ─── Location Dedup Map (normalize variants to canonical LinkedIn-style format) ───
const LOCATION_CANONICAL: Record<string, string> = {
  // UK variants
  'london': 'London, United Kingdom',
  'london, uk': 'London, United Kingdom',
  'london - uk': 'London, United Kingdom',
  'london, united kingdom': 'London, United Kingdom',
  'london england': 'London, United Kingdom',
  'london gb': 'London, United Kingdom',
  'manchester': 'Manchester, United Kingdom',
  'manchester, uk': 'Manchester, United Kingdom',
  'manchester, united kingdom': 'Manchester, United Kingdom',
  'edinburgh': 'Edinburgh, United Kingdom',
  'edinburgh, uk': 'Edinburgh, United Kingdom',
  'edinburgh, united kingdom': 'Edinburgh, United Kingdom',
  'bristol': 'Bristol, United Kingdom',
  'bristol, uk': 'Bristol, United Kingdom',
  'bristol, united kingdom': 'Bristol, United Kingdom',
  'cambridge': 'Cambridge, United Kingdom',
  'cambridge, uk': 'Cambridge, United Kingdom',
  'cambridge, united kingdom': 'Cambridge, United Kingdom',
  'oxford': 'Oxford, United Kingdom',
  'oxford, uk': 'Oxford, United Kingdom',
  'oxford, united kingdom': 'Oxford, United Kingdom',
  'birmingham': 'Birmingham, United Kingdom',
  'birmingham, uk': 'Birmingham, United Kingdom',
  'birmingham, united kingdom': 'Birmingham, United Kingdom',
  'leeds': 'Leeds, United Kingdom',
  'leeds, uk': 'Leeds, United Kingdom',
  'leeds, united kingdom': 'Leeds, United Kingdom',
  // India variants
  'bangalore': 'Bangalore, India',
  'bangalore, karnataka': 'Bangalore, India',
  'bengaluru': 'Bangalore, India',
  'bengaluru, karnataka': 'Bangalore, India',
  'mumbai': 'Mumbai, India',
  'mumbai, maharashtra': 'Mumbai, India',
  'delhi': 'Delhi, India',
  'new delhi': 'Delhi, India',
  'new delhi, india': 'Delhi, India',
  'hyderabad': 'Hyderabad, India',
  'hyderabad, telangana': 'Hyderabad, India',
  'pune': 'Pune, India',
  'pune, maharashtra': 'Pune, India',
  'chennai': 'Chennai, India',
  'chennai, tamil nadu': 'Chennai, India',
  'gurgaon': 'Gurgaon, India',
  'gurugram': 'Gurgaon, India',
  'noida': 'Noida, India',
  'noida, uttar pradesh': 'Noida, India',
  // US variants
  'sf': 'San Francisco, CA',
  'san francisco': 'San Francisco, CA',
  'sf, ca': 'San Francisco, CA',
  'san francisco, california': 'San Francisco, CA',
  'nyc': 'New York, NY',
  'new york': 'New York, NY',
  'new york city': 'New York, NY',
  'new york, new york': 'New York, NY',
  'seattle': 'Seattle, WA',
  'seattle, washington': 'Seattle, WA',
  'austin': 'Austin, TX',
  'austin, texas': 'Austin, TX',
  'la': 'Los Angeles, CA',
  'los angeles': 'Los Angeles, CA',
  'los angeles, california': 'Los Angeles, CA',
  'chicago': 'Chicago, IL',
  'chicago, illinois': 'Chicago, IL',
  'boston': 'Boston, MA',
  'boston, massachusetts': 'Boston, MA',
  'denver': 'Denver, CO',
  'denver, colorado': 'Denver, CO',
  'portland': 'Portland, OR',
  'portland, oregon': 'Portland, OR',
  'atlanta': 'Atlanta, GA',
  'atlanta, georgia': 'Atlanta, GA',
  'miami': 'Miami, FL',
  'miami, florida': 'Miami, FL',
  'dallas': 'Dallas, TX',
  'dallas, texas': 'Dallas, TX',
  'houston': 'Houston, TX',
  'houston, texas': 'Houston, TX',
  'phoenix': 'Phoenix, AZ',
  'phoenix, arizona': 'Phoenix, AZ',
  'san diego': 'San Diego, CA',
  'san diego, california': 'San Diego, CA',
  'washington dc': 'Washington, DC',
  'washington, dc': 'Washington, DC',
  'washington, d.c.': 'Washington, DC',
  'dc': 'Washington, DC',
  // Canada
  'toronto': 'Toronto, Canada',
  'toronto, ontario': 'Toronto, Canada',
  'vancouver': 'Vancouver, Canada',
  'vancouver, british columbia': 'Vancouver, Canada',
  'montreal': 'Montreal, Canada',
  'montreal, quebec': 'Montreal, Canada',
  // Germany
  'berlin': 'Berlin, Germany',
  'munich': 'Munich, Germany',
  'münchen': 'Munich, Germany',
  // Other
  'amsterdam': 'Amsterdam, Netherlands',
  'dublin': 'Dublin, Ireland',
  'barcelona': 'Barcelona, Spain',
  'paris': 'Paris, France',
  'zurich': 'Zurich, Switzerland',
  'stockholm': 'Stockholm, Sweden',
  'singapore': 'Singapore, Singapore',
  'tokyo': 'Tokyo, Japan',
  'sydney': 'Sydney, Australia',
  'melbourne': 'Melbourne, Australia',
  'sao paulo': 'São Paulo, Brazil',
  'são paulo': 'São Paulo, Brazil',
  'mexico city': 'Mexico City, Mexico',
  'tel aviv': 'Tel Aviv, Israel',
  // Work modes
  'remote': 'Remote',
  'hybrid': 'Hybrid',
  'on-site': 'On-site',
  'onsite': 'On-site',
  'on site': 'On-site',
}

function normalizeLocation(raw: string): string {
  const key = raw.toLowerCase().trim()
  // Check exact match in canonical map
  if (LOCATION_CANONICAL[key]) return LOCATION_CANONICAL[key]
  // If it already looks like "City, Country" format, keep it
  if (raw.includes(',') && raw.split(',').length === 2) {
    const parts = raw.split(',').map(s => s.trim())
    // Capitalize each part properly
    return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')
  }
  // Just capitalize
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

const JOB_TITLE_TAXONOMY = [
  // Engineering
  'Software Engineer', 'Senior Software Engineer', 'Staff Software Engineer',
  'Principal Software Engineer', 'Lead Software Engineer', 'Software Architect',
  'Full Stack Developer', 'Frontend Developer', 'Backend Developer',
  'Mobile Developer', 'iOS Developer', 'Android Developer',
  'Web Developer', 'DevOps Engineer', 'Site Reliability Engineer',
  'Platform Engineer', 'Infrastructure Engineer', 'Cloud Engineer',
  'Data Engineer', 'ML Engineer', 'Machine Learning Engineer',
  'AI Engineer', 'NLP Engineer', 'Computer Vision Engineer',
  'Systems Engineer', 'Network Engineer', 'Security Engineer',
  'Embedded Systems Engineer', 'Firmware Engineer', 'Hardware Engineer',
  'QA Engineer', 'Test Engineer', 'SDET', 'Automation Engineer',
  'Release Engineer', 'Build Engineer',
  // Data
  'Data Scientist', 'Senior Data Scientist', 'Lead Data Scientist',
  'Data Analyst', 'Business Intelligence Analyst', 'Analytics Engineer',
  'Quantitative Analyst', 'Research Scientist', 'Applied Scientist',
  // Product
  'Product Manager', 'Senior Product Manager', 'Director of Product',
  'VP of Product', 'Product Owner', 'Product Designer',
  'UX Designer', 'UI Designer', 'UX Researcher', 'UX Engineer',
  'Interaction Designer', 'Visual Designer', 'Design Lead',
  // Management
  'Engineering Manager', 'Senior Engineering Manager', 'Director of Engineering',
  'VP of Engineering', 'CTO', 'Chief Technology Officer',
  'Team Lead', 'Technical Lead', 'Tech Lead', 'Squad Lead',
  'Project Manager', 'Program Manager', 'Scrum Master',
  // Specialized
  'Solutions Architect', 'Cloud Architect', 'Enterprise Architect',
  'Database Administrator', 'DBA', 'Systems Administrator',
  'IT Support Specialist', 'Technical Support Engineer',
  'DevRel', 'Developer Advocate', 'Developer Experience Engineer',
  'Technical Writer', 'Documentation Engineer',
  // Consulting
  'Consultant', 'Senior Consultant', 'Manager', 'Senior Manager',
  'Associate', 'Analyst', 'Senior Analyst',
]

// ─── Cache ────────────────────────────────────────────────────

const cache: {
  skills: Suggestion[]
  location: Suggestion[]
  job_title: Suggestion[]
  lastRefresh: number
} = {
  skills: [],
  location: [],
  job_title: [],
  lastRefresh: 0,
}

const REFRESH_MS = 300_000 // 5 min — taxonomy rarely changes

async function refreshCache() {
  try {
    // ── Skills: merge taxonomy + DB frequency ──
    const rawSkillsRes = await pool.query<{ raw: string }>(`
      SELECT elem::text AS raw
      FROM candidates, jsonb_array_elements(skills) AS elem
      WHERE skills IS NOT NULL AND jsonb_array_length(skills) > 0
    `)
    // Count DB occurrences per lowercase key
    const dbCounts = new Map<string, number>()
    for (const row of rawSkillsRes.rows) {
      let name = ''
      try {
        const parsed = JSON.parse(row.raw)
        name = typeof parsed === 'string' ? parsed : (parsed?.name || '')
      } catch {
        name = row.raw.replace(/^["']|["']$/g, '').trim()
      }
      if (name && name.length >= 2) {
        const key = name.toLowerCase()
        dbCounts.set(key, (dbCounts.get(key) || 0) + 1)
      }
    }
    // Build skills from taxonomy (LinkedIn-style with category sublabel)
    const skillSet = new Map<string, Suggestion>()
    for (const skill of ALL_SKILLS) {
      const key = skill.value.toLowerCase()
      skillSet.set(key, {
        value: skill.value,
        label: skill.value,
        sublabel: skill.category,
        count: dbCounts.get(key) || 0,
        type: 'skill',
      })
    }
    cache.skills = Array.from(skillSet.values())
      .sort((a, b) => b.count - a.count)

    // ── Locations: taxonomy + DB extras (with dedup) ──
    const locRes = await pool.query<{ location: string; count: string }>(`
      SELECT location, COUNT(*) AS count
      FROM candidates
      WHERE location IS NOT NULL AND location != ''
      GROUP BY location
      ORDER BY COUNT(*) DESC
    `)
    const locMap = new Map<string, Suggestion>()
    // Add taxonomy first (normalized)
    for (const loc of LOCATION_TAXONOMY) {
      const canonical = normalizeLocation(loc)
      const key = canonical.toLowerCase()
      if (!locMap.has(key)) {
        locMap.set(key, {
          value: canonical,
          label: canonical,
          count: 0,
          type: 'location',
        })
      }
    }
    // Overlay DB counts (with dedup via normalizeLocation)
    for (const row of locRes.rows) {
      const canonical = normalizeLocation(row.location)
      const key = canonical.toLowerCase()
      const existing = locMap.get(key)
      if (existing) {
        existing.count += parseInt(row.count, 10)
      } else if (canonical.length <= 60) {
        locMap.set(key, {
          value: canonical,
          label: canonical,
          count: parseInt(row.count, 10),
          type: 'location',
        })
      }
    }
    cache.location = Array.from(locMap.values())
      .sort((a, b) => b.count - a.count)

    // ── Job Titles: taxonomy + DB extras ──
    const titleRes = await pool.query<{ title: string; count: string }>(`
      SELECT
        TRIM(
          REGEXP_REPLACE(
            REGEXP_REPLACE(headline, '\s+at\s+.*$', '', 'i'),
            '\s*[|–—-]\s*.*$', ''
          )
        ) AS title,
        COUNT(*) AS count
      FROM candidates
      WHERE headline IS NOT NULL AND headline != ''
      GROUP BY title
      ORDER BY COUNT(*) DESC
    `)
    const titleMap = new Map<string, Suggestion>()
    for (const t of JOB_TITLE_TAXONOMY) {
      titleMap.set(t.toLowerCase(), { value: t, label: t, count: 0, type: 'job_title' })
    }
    for (const row of titleRes.rows) {
      const t = row.title.trim()
      if (t.length < 3 || t.length > 80) continue
      const key = t.toLowerCase()
      const existing = titleMap.get(key)
      if (existing) {
        existing.count = parseInt(row.count, 10)
      } else if (parseInt(row.count, 10) >= 2) {
        titleMap.set(key, {
          value: t, label: t,
          count: parseInt(row.count, 10), type: 'job_title',
        })
      }
    }
    cache.job_title = Array.from(titleMap.values())
      .filter(t => {
        const lower = t.value.toLowerCase()
        // Filter out Kaggle metadata, company names, and junk
        if (/datasets|kernels|votes|notebooks/.test(lower)) return false
        if (t.value.length < 4) return false
        // Filter entries that look like company names (single word, no space)
        if (!t.value.includes(' ') && t.count === 0) return false
        return true
      })
      .sort((a, b) => b.count - a.count)

    cache.lastRefresh = Date.now()
    console.log(
      `[Autocomplete] Taxonomy loaded: ${cache.skills.length} skills, ${cache.location.length} locations, ${cache.job_title.length} titles`
    )
  } catch (error) {
    console.error('[Autocomplete] Cache refresh failed:', error)
  }
}

// ─── Routes ───────────────────────────────────────────────────

autocompleteRouter.get('/', async (req: Request, res: Response) => {
  try {
    const type = (req.query.type as string) || 'skills'
    const q = ((req.query.q as string) || '').trim().toLowerCase()
    const limit = Math.min(parseInt(req.query.limit as string) || 8, 20)

    if (Date.now() - cache.lastRefresh > REFRESH_MS) {
      refreshCache()
    }

    const items: Suggestion[] = cache[type as keyof typeof cache] as Suggestion[] || cache.skills

    if (!q || q.length < 1) {
      res.json({ suggestions: items.slice(0, limit) })
      return
    }

    const prefixMatches: Suggestion[] = []
    const containsMatches: Suggestion[] = []

    for (const item of items) {
      const lower = item.label.toLowerCase()
      if (lower === q) {
        prefixMatches.unshift(item)
      } else if (lower.startsWith(q)) {
        prefixMatches.push(item)
      } else if (lower.includes(q)) {
        containsMatches.push(item)
      }
      if (prefixMatches.length + containsMatches.length >= limit * 3) break
    }

    res.json({ suggestions: [...prefixMatches, ...containsMatches].slice(0, limit) })
  } catch (error) {
    console.error('[Autocomplete] Error:', error)
    res.json({ suggestions: [] })
  }
})

autocompleteRouter.post('/refresh', async (_req: Request, res: Response) => {
  await refreshCache()
  res.json({
    refreshed: true,
    counts: {
      skills: cache.skills.length,
      locations: cache.location.length,
      jobTitles: cache.job_title.length,
    },
  })
})

// ─── Initial load ─────────────────────────────────────────────
refreshCache()
