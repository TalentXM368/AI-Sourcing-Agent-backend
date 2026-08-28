import { Router, Request, Response } from 'express'
import { pool } from '../db/index.js'

export const autocompleteRouter = Router()

// ─── Types ────────────────────────────────────────────────────

interface Suggestion {
  value: string
  label: string
  sublabel?: string
  count: number
  type: 'skill' | 'location' | 'job_title' | 'company' | 'school' | 'degree' | 'language' | 'industry' | 'region'
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

// ─── Junk Filters ─────────────────────────────────────────────

// Resume section headers that get mis-parsed as company names
const RESUME_SECTION_HEADERS = new Set([
  'responsibilities', 'key responsibilities', 'duties', 'responsibility',
  'duration', 'summary', 'professional summary', 'career objective', 'objective',
  'projects', 'project', 'work experience', 'work history', 'experience',
  'professional experience', 'education', 'academic details', 'qualifications',
  'skills', 'technical skills', 'additional skills', 'languages', 'certifications',
  'courses', 'coursework', 'hobbies', 'interests', 'personal details',
  'personal profile', 'profile', 'declaration', 'about', 'about me', 'contact',
  'references', 'achievements', 'awards', 'memberships', 'volunteer', 'strengths',
  'overview', 'key skills', 'highlights', 'areas of interest', 'trainings',
  'internships', 'extracurricular', 'projects done', 'key contributions',
  'project overview', 'job duties', 'duties', 'employment history',
  'experience summary', 'work', 'employment', 'roles & responsibilities',
  'roles and responsibilities', 'responsibilities & achievements',
  'achievements', 'accomplishments',
])

// Known location/city/country names that should never be companies
const KNOWN_LOCATION_NAMES = new Set<string>()
for (const key of Object.keys(LOCATION_CANONICAL)) {
  const city = key.split(/[,)]/)[0].trim()
  if (city.length >= 2) KNOWN_LOCATION_NAMES.add(city)
}
for (const loc of LOCATION_TAXONOMY) {
  const city = loc.split(/[,)]/)[0].trim().toLowerCase()
  if (city.length >= 2) KNOWN_LOCATION_NAMES.add(city)
}
for (const place of [
  // Countries / territories
  'india', 'usa', 'us', 'uae', 'uk', 'gulf', 'abroad', 'remote', 'hybrid',
  'onsite', 'on-site', 'work from home', 'wfh', 'ncr', 'home', 'city', 'location',
  'united states', 'united states of america', 'america', 'canada', 'australia',
  'united kingdom', 'england', 'scotland', 'wales', 'ireland', 'germany',
  'france', 'netherlands', 'belgium', 'switzerland', 'austria', 'sweden',
  'norway', 'denmark', 'finland', 'italy', 'spain', 'portugal', 'poland',
  'czech republic', 'romania', 'hungary', 'greece', 'turkey', 'israel',
  'uae', 'saudi arabia', 'qatar', 'kuwait', 'oman', 'jordan', 'bahrain',
  'china', 'japan', 'south korea', 'taiwan', 'singapore', 'malaysia',
  'thailand', 'vietnam', 'indonesia', 'philippines', 'hong kong', 'bangladesh',
  'pakistan', 'sri lanka', 'nepal', 'bhutan', 'myanmar', 'cambodia', 'laos',
  'australia', 'new zealand', 'brazil', 'mexico', 'argentina', 'chile',
  'colombia', 'peru', 'venezuela', 'ecuador', 'costa rica', 'panama',
  'south africa', 'nigeria', 'kenya', 'egypt', 'morocco', 'ethiopia',
  'ghana', 'uganda', 'tanzania', 'zimbabwe', 'namibia', 'botswana',
  'russia', 'ukraine', 'kazakhstan', 'uzbekistan',
  // US states
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
  'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
  'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine',
  'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi',
  'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey',
  'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio',
  'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina',
  'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia',
  'washington', 'west virginia', 'wisconsin', 'wyoming',
  // Indian states / UTs
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh',
  'goa', 'gujarat', 'haryana', 'himachal pradesh', 'jharkhand', 'karnataka',
  'kerala', 'madhya pradesh', 'maharashtra', 'manipur', 'meghalaya',
  'mizoram', 'nagaland', 'odisha', 'orissa', 'punjab', 'rajasthan',
  'sikkim', 'tamil nadu', 'telangana', 'tripura', 'uttar pradesh',
  'uttarakhand', 'west bengal', 'andaman', 'chandigarh', 'dadra',
  'daman', 'diu', 'jammu', 'kashmir', 'ladakh', 'lakshadweep', 'puducherry',
  // Indian cities
  'bangalore', 'bengaluru', 'mumbai', 'delhi', 'new delhi', 'hyderabad',
  'pune', 'chennai', 'kolkata', 'ahmedabad', 'gurgaon', 'gurugram', 'noida',
  'jaipur', 'kochi', 'kolkata', 'lucknow', 'indore', 'bhopal', 'surat',
  'nagpur', 'visakhapatnam', 'vijayawada', 'coimbatore', 'madurai', 'mysore',
  'trivandrum', 'kozhikode', 'kannur', 'kottayam', 'thrissur', 'kochi',
  'amritsar', 'ludhiana', 'chandigarh', 'kanpur', 'varanasi', 'agra',
  'meerut', 'rajkot', 'vadodara', 'nashik', 'aurangabad', 'solapur',
  'kolhapur', 'thane', 'navi mumbai', 'faridabad', 'ghaziabad',
  'patna', 'ranchi', 'raipur', 'bhubaneswar', 'cuttack', 'guwahati',
  'dehradun', 'shimla', 'jammu', 'srinagar', 'gangtok', 'itanagar',
  'aizawl', 'imphal', 'shillong', 'agartala', 'panaji', 'puducherry',
  'jalandhar', 'jodhpur', 'udaipur', 'ajmer', 'kota', 'bikaner', 'jaisalmer',
  'siliguri', 'asansol', 'dhanbad', 'jamshedpur', 'salem', 'erode',
  'tiruchirappalli', 'vellore', 'thoothukudi', 'nellore', 'kakinada',
  'tirupati', 'warangal', 'nizamabad', 'karimnagar', 'guntur', 'ongole',
  'rajahmundry', 'eluru', 'kurnool', 'anantapur', 'bellary', 'hubli',
  'mangalore', 'udupi', 'belgaum', 'gulbarga', 'dharwad', 'bijapur',
  'shimoga', 'tumkur', 'davangere', 'ballari', 'mohali', 'panchkula',
  'karnal', 'panipat', 'ambala', 'rohtak', 'hisar', 'sonipat', 'yamluna',
  'meerut', 'moradabad', 'gorakhpur', 'jhansi', 'allahabad', 'prayagraj',
  // Other global cities
  'san antonio', 'philadelphia', 'san jose', 'san diego', 'detroit',
  'minneapolis', 'st. louis', 'st louis', 'baltimore', 'las vegas',
  'cincinnati', 'cleveland', 'kansas city', 'milwaukee', 'pittsburgh',
  'memphis', 'new orleans', 'louisville', 'portland', 'sacramento',
  'columbus', 'indianapolis', 'saint paul', 'salt lake city', 'tampa',
  'orlando', 'charlotte', 'raleigh', 'nashville', 'durham', 'richmond',
  'hartford', 'providence', 'albuquerque', 'omaha', 'tucson', 'fresno',
  'long beach', 'oakland', 'austin', 'dallas', 'houston', 'seattle',
  'miami', 'atlanta', 'chicago', 'boston', 'denver', 'phoenix',
  'sao paulo', 'toronto', 'vancouver', 'montreal', 'london', 'manchester',
  'birmingham', 'leeds', 'berlin', 'munich', 'hamburg', 'paris', 'dublin',
  'amsterdam', 'barcelona', 'madrid', 'rome', 'milan', 'stockholm',
  'oslo', 'helsinki', 'copenhagen', 'zurich', 'geneva', 'vienna',
  'warsaw', 'prague', 'budapest', 'athens', 'istanbul', 'dubai', 'abu dhabi',
  'doha', 'riyadh', 'jeddah', 'kuwait city', 'singapore', 'hong kong',
  'shanghai', 'beijing', 'shenzhen', 'tokyo', 'osaka', 'seoul', 'bangkok',
  'manila', 'jakarta', 'kuala lumpur', 'ho chi minh city', 'sydney',
  'melbourne', 'brisbane', 'perth', 'auckland', 'johannesburg', 'cairo',
  'lagos', 'nairobi', 'santiago', 'bogota', 'lima', 'buenos aires',
  'santa clara', 'mountain view', 'sunnyvale', 'palo alto', 'cupertino',
  'redmond', 'bellevue', 'plano', 'frisco', 'charleston', 'lexington',
]) {
  KNOWN_LOCATION_NAMES.add(place)
}

// Job-title keywords — a value made purely of these is a parsed title, not a company
const JOB_TITLE_WORDS = /\b(engineer|developer|scientist|analyst|analytics|manager|intern|trainee|apprentice|associate|consultant|consulting|architect|designer|specialist|coordinator|administrator|executive|officer|representative|supervisor|recruiter|trainer|teacher|professor|accountant|attorney|advocate|nurse|physician|doctor|researcher|lead|head|director|principal|staff|senior|junior|full.?stack|front.?end|back.?end|devops|data|sde)\b/i

// Company-legal words — if a value has one of these it is (probably) a real org.
// Deliberately excludes ambiguous words like "software", "systems", "data",
// "power", "digital" that also appear inside job titles.
const COMPANY_WORDS = /\b(inc|llc|ltd|corp|corporation|company|group|health|healthcare|bank|capital|global|international|industries|industrial|holdings|partners|partner|labs|technologies|technology|solutions|solution|services|service|stores|retail|motors|airways|airlines|express|energy|insurance|ventures|fund|trust|association|foundation|institute|university|college|academy|hospital|clinic|center|centre|works|manufacturing)\b/i

// Generic single words that are resume/parser truncation artifacts
const JUNK_COMPANY_WORDS = new Set([
  'new', 'full', 'virtual', 'home', 'work', 'current', 'team', 'role', 'job',
  'office', 'firm', 'company', 'all', 'top', 'best', 'present', 'same', 'other',
  'issued', 'issue', 'date', 'details', 'info', 'information', 'career',
  'overview', 'projects', 'achievements', 'till', 'until', 'from', 'to',
])

// Date-range phrases ("Till Date", "To Present", "Up to Date")
const JUNK_DATE_PHRASE = /^(till|to|up\s?to|as\s?of|until)\s+(date|now|present|today|current)\b/i

const JUNK_COMPANY = /^(present|current|self[- ]?employed|freelance|independent|intern|internship|student|n\/a|self|anonymous|unknown|not specified|unemployed)$/i
const JUNK_DATE = /^(20\d{2}|19\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|\d{4}\s*[-–]\s*\d{4}|\d{4}\s*[-–]\s*present|\d{4}\s*[-–]\s*current)/i
const JUNK_TITLE = /^(20\d{2}|19\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|\d+\s*(year|month|yr|mo|week|wk|day|hour|hr)s?\s*(of)?\s*(experience|exp|internship)?|n\/a|present|current|remote|hybrid|onsite|on[- ]site|full[- ]time|part[- ]time|contract|freelance|self[- ]?employed|student|intern|internship|client|client\s*:)$/i
const JUNK_DEGREE = /^(mba|mbai|mbai[.,)\/]|b\.?tech|b\.?e\.?|m\.?tech|m\.?e\.?|b\.?sc|m\.?sc|b\.?ca|m\.?ca|b\.?com|m\.?com|ph\.?d|d\.?phil)\s*[.,)\/]?\s*$/i
const JUNK_LANG = /^(sports|music|dance|art|reading|travel|cooking|photography|gardening|painting|drawing|gaming|fitness|yoga|meditation|member|personal|profile|details|declaration|nationality|indian|passport|language\s*:?|known\s*:?|english\s*[:–—-]\s*fluent|english\s*[:–—-]\s*basic|english\s*[:–—-]\s*intermediate|english\s*[:–—-]\s*native)$/i
const JUNK_SCHOOL = /^(n\/a|na|none|unknown|not specified|self|university|college|school|institute|online|remote)$/i

const KNOWN_LANGUAGES = new Set([
  'english', 'spanish', 'french', 'german', 'chinese', 'mandarin', 'cantonese',
  'japanese', 'korean', 'arabic', 'hindi', 'bengali', 'portuguese', 'russian',
  'italian', 'dutch', 'turkish', 'polish', 'thai', 'vietnamese', 'indonesian',
  'malay', 'filipino', 'tagalog', 'swedish', 'norwegian', 'danish', 'finnish',
  'greek', 'hebrew', 'romanian', 'hungarian', 'czech', 'slovak', 'ukrainian',
  'persian', 'urdu', 'tamil', 'telugu', 'marathi', 'gujarati', 'kannada',
  'malayalam', 'punjabi', 'odia', 'assamese', 'maithili', 'sindhi',
  'swahili', 'amharic', 'yoruba', 'igbo', 'hausa', 'zulu', 'xhosa',
  'catalan', 'basque', 'galician', 'serbian', 'croatian', 'bosnian',
  'bulgarian', 'slovenian', 'estonian', 'latvian', 'lithuanian',
  'icelandic', 'irish', 'welsh', 'scottish gaelic', 'maori',
  'khmer', 'lao', 'burmese', 'nepali', 'sinhala', 'mongolian',
  'georgian', 'armenian', 'azerbaijani', 'kazakh', 'uzbek',
  'pashto', 'dari', 'kurdish', 'tigrinya',
])

// Normalize raw text: collapse whitespace, strip leading/trailing punctuation
// (loops so "India) " and "Responsibilities:" fully collapse)
const TEXT_EDGE = /[-–—|:.,;()]/
function normalizeText(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim()
  while (t && TEXT_EDGE.test(t[0])) t = t.slice(1).trim()
  while (t && TEXT_EDGE.test(t[t.length - 1])) t = t.slice(0, -1).trim()
  return t
}

// Reject values that are mostly single uppercase letters separated by spaces ("I N N O D A")
const LETTER_SPACED = /^([A-Z])\s+(\1\s+)+[A-Z]$/i

// Reject values that are long sentence-like blobs with multiple common verbs
const SENTENCE_LIKE = /\b(at|and|with|for|the|from|working|client|based)\b.{0,20}\b(at|and|for|the)\b/i

function isJunkCompany(name: string): boolean {
  const t = normalizeText(name)
  if (t.length < 2 || t.length > 80) return true
  if (JUNK_COMPANY.test(t)) return true
  if (JUNK_DATE.test(t)) return true
  if (/^\d+$/.test(t)) return true
  if (/^[\d\s\-–/,]+$/.test(t)) return true
  if (LETTER_SPACED.test(t)) return true
  if (SENTENCE_LIKE.test(t)) return true
  if (/^(LL\.?\s*B|adv\.?|advocate|chambers?)/i.test(t)) return true
  if (/^\d+\s*(year|month|yr|mo)s?\b/i.test(t)) return true
  if (/^client\s*[:—]/i.test(t)) return true
  if (/^university\s+of/i.test(t)) return true
  if (JUNK_DATE_PHRASE.test(t)) return true
  const lower = t.toLowerCase()
  // Resume section headers parsed as company names
  if (RESUME_SECTION_HEADERS.has(lower)) return true
  // Location/city/country names parsed as company names (exact, or all comma parts)
  if (KNOWN_LOCATION_NAMES.has(lower)) return true
  if (lower.includes(',') && lower.split(',').every(p => KNOWN_LOCATION_NAMES.has(p.trim()))) return true
  // Single generic truncation words ("New", "Full", "Virtual")
  if (JUNK_COMPANY_WORDS.has(lower)) return true
  // Job-title-like values that contain no company-legal word
  if (JOB_TITLE_WORDS.test(lower) && !COMPANY_WORDS.test(lower)) return true
  // Title-like entries (e.g. "legal intern", "software engineer trainee")
  if (/\b(intern|internship|trainee|fresher|student|apprentice)\b/i.test(lower)) return true
  return false
}

function isJunkTitle(title: string): boolean {
  const t = normalizeText(title)
  if (t.length < 3 || t.length > 80) return true
  if (JUNK_TITLE.test(t)) return true
  if (/^\d+$/.test(t)) return true
  if (/^[\d\s\-–/,]+$/.test(t)) return true
  if (/^.{0,2}$/.test(t)) return true
  if (LETTER_SPACED.test(t)) return true
  if (/^(LL\.?\s*B|adv\.?|advocate|chambers?)/i.test(t)) return true
  if (/^client\s*[:—]/i.test(t)) return true
  if (/^unknown\b/i.test(t)) return true
  const lower = t.toLowerCase()
  // Resume section headers parsed as titles
  if (RESUME_SECTION_HEADERS.has(lower)) return true
  // Location names parsed as titles (e.g. "Hyderabad, India")
  if (KNOWN_LOCATION_NAMES.has(lower)) return true
  if (lower.includes(',') && lower.split(',').every(p => KNOWN_LOCATION_NAMES.has(p.trim()))) return true
  return false
}

// Locations should be real places — reject school/degree/name-like strings
function isJunkLocation(location: string): boolean {
  const t = normalizeText(location)
  if (t.length < 2 || t.length > 80) return true
  if (JUNK_DATE.test(t)) return true
  if (/^\d+$/.test(t)) return true
  if (LETTER_SPACED.test(t)) return true
  if (/(university|college|school|institute|campus|academy|degree|bachelor|master|ph\.?d|LL\.?\s*B|mba|B\.?tech|from)/i.test(t)) return true
  if (/^(adv\.?|advocate|chambers?|self[- ]?employed|freelance|remote|hybrid|on[- ]site|onsite)/i.test(t)) return true
  if (/\b(at|and|for|the|from|with)\b.*\b(at|and|for|the)\b/i.test(t)) return true
  return false
}

function isJunkSchool(school: string): boolean {
  const t = normalizeText(school)
  if (t.length < 2 || t.length > 120) return true
  if (JUNK_SCHOOL.test(t)) return true
  if (/^\d+$/.test(t)) return true
  if (LETTER_SPACED.test(t)) return true
  return false
}

function isJunkDegree(degree: string): boolean {
  const t = degree.trim()
  if (t.length < 2 || t.length > 80) return true
  if (JUNK_DEGREE.test(t)) return true
  if (/^\d+$/.test(t)) return true
  return false
}

function isJunkLanguage(lang: string): boolean {
  const t = lang.trim().toLowerCase()
  if (t.length < 2 || t.length > 30) return true
  if (JUNK_LANG.test(t)) return true
  if (/^\d+$/.test(t)) return true
  // If it matches a known language (or starts with one), keep it
  for (const known of KNOWN_LANGUAGES) {
    if (t === known || t.startsWith(known + ' ') || t.startsWith(known + ':') || t.startsWith(known + ' (')) return false
  }
  // If it's just a known language with colon/parenthetical suffix, keep it
  if (/^(english|spanish|french|germand|hindi|chinese|japanese|korean|arabic|portuguese|russian|italian|dutch|turkish|polish|thai|vietnamese|indonesian|malay|bengali|tamil|telugu|marathi|gujarati|kannada|malayalam|punjabi)[\s:]/i.test(t)) return false
  // Not a known language → junk
  return true
}

function normalizeLanguage(raw: string): string {
  const t = raw.trim()
  // Extract just the language name before any colon/parenthetical
  const match = t.match(/^([A-Za-z\s]+)/)
  if (match) {
    const name = match[1].trim()
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
  }
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function normalizeDegree(raw: string): string {
  let t = raw.trim()
  // Strip trailing punctuation / dashes ("MBA –" -> "MBA")
  t = t.replace(/[-–—|:.,;()]+$/, '').trim()
  return t
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
  skill: Suggestion[]
  location: Suggestion[]
  job_title: Suggestion[]
  company: Suggestion[]
  school: Suggestion[]
  degree: Suggestion[]
  language: Suggestion[]
  industry: Suggestion[]
  region: Suggestion[]
  lastRefresh: number
} = {
  skill: [],
  location: [],
  job_title: [],
  company: [],
  school: [],
  degree: [],
  language: [],
  industry: [],
  region: [],
  lastRefresh: 0,
}

const REFRESH_MS = 300_000 // 5 min — taxonomy rarely changes

async function refreshCache() {
  const startTime = Date.now()
  console.log('[Autocomplete] Starting cache refresh...')

  try {
    // Run queries sequentially with individual timeouts to avoid pool exhaustion
  const queries = [
    { name: 'skills', sql: `
      SELECT elem::text AS raw
      FROM candidates, jsonb_array_elements(skills) AS elem
      WHERE skills IS NOT NULL AND jsonb_array_length(skills) > 0
    ` },
    { name: 'locations', sql: `
      SELECT location, COUNT(*) AS count
      FROM candidates
      WHERE location IS NOT NULL AND location != ''
      GROUP BY location
      ORDER BY COUNT(*) DESC
    ` },
    { name: 'titles', sql: `
      SELECT title, COUNT(*) AS count FROM (
        SELECT TRIM(REGEXP_REPLACE(REGEXP_REPLACE(headline, '\s+at\s+.*$', '', 'i'), '\s*[|–—-]\s*.*$', '')) AS title
        FROM candidates WHERE headline IS NOT NULL AND headline != ''
        UNION ALL
        SELECT TRIM(elem->>'title') AS title
        FROM candidates, jsonb_array_elements(work_history) AS elem
        WHERE work_history IS NOT NULL AND jsonb_array_length(work_history) > 0 AND elem->>'title' IS NOT NULL AND elem->>'title' != ''
        UNION ALL
        SELECT TRIM(elem->>'title') AS title
        FROM candidates, jsonb_array_elements(companies) AS elem
        WHERE companies IS NOT NULL AND jsonb_array_length(companies) > 0 AND elem->>'title' IS NOT NULL AND elem->>'title' != ''
      ) sub
      WHERE title IS NOT NULL AND title != ''
      GROUP BY title
      ORDER BY COUNT(*) DESC
    ` },
    { name: 'companies', sql: `
      SELECT jsonb_array_elements(candidates.companies)->>'name' AS company
      FROM candidates
      WHERE candidates.companies IS NOT NULL AND jsonb_array_length(candidates.companies) > 0
    ` },
    { name: 'schools', sql: `
      SELECT jsonb_array_elements(candidates.education)->>'school' AS school
      FROM candidates
      WHERE candidates.education IS NOT NULL AND jsonb_array_length(candidates.education) > 0
    ` },
    { name: 'degrees', sql: `
      SELECT jsonb_array_elements(candidates.education)->>'degree' AS degree
      FROM candidates
      WHERE candidates.education IS NOT NULL AND jsonb_array_length(candidates.education) > 0
    ` },
    { name: 'languages', sql: `
      SELECT jsonb_array_elements(candidates.languages)->>'name' AS lang
      FROM candidates
      WHERE candidates.languages IS NOT NULL AND jsonb_array_length(candidates.languages) > 0
    ` },
    { name: 'industries', sql: `
      SELECT industry, COUNT(*)::text AS count
      FROM candidates
      WHERE industry IS NOT NULL AND industry != ''
      GROUP BY industry
      ORDER BY COUNT(*) DESC
    ` },
    { name: 'regions', sql: `
      SELECT region, COUNT(*)::text AS count
      FROM candidates
      WHERE region IS NOT NULL AND region != '' AND region != 'Unknown/Global'
      GROUP BY region
      ORDER BY COUNT(*) DESC
    ` },
  ]

  const results: Record<string, any> = {}

  for (const query of queries) {
    try {
      const result = await pool.query(query.sql)
      results[query.name] = result
    } catch (err: any) {
      console.error(`[Autocomplete] Query "${query.name}" failed:`, err.message)
      results[query.name] = { rows: [] }
    }
  }

  const { skills: rawSkillsRes, locations: locRes, titles: titleRes, companies: compRes,
          schools: schoolRes, degrees: degreeRes, languages: langRes, industries: indRes, regions: regRes } = results

    // ── 1. Process Skills ──
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
    const skillSet = new Map<string, Suggestion>()
    for (const skill of ALL_SKILLS) {
      const key = skill.value.toLowerCase()
      skillSet.set(key, { value: skill.value, label: skill.value, sublabel: skill.category, count: dbCounts.get(key) || 0, type: 'skill' })
    }
    const normalizedSkills = new Map<string, string>()
    for (const skill of ALL_SKILLS) normalizedSkills.set(skill.value.toLowerCase(), skill.value)
    for (const [rawName, count] of dbCounts) {
      const name = normalizeText(rawName)
      if (name.length < 2 || name.length > 60) continue
      const key = name.toLowerCase()
      if (normalizedSkills.has(key)) {
        const existing = skillSet.get(key)
        if (existing) existing.count = Math.max(existing.count, count)
        continue
      }
      if (LETTER_SPACED.test(name) || SENTENCE_LIKE.test(name) || JUNK_DATE.test(name)) continue
      normalizedSkills.set(key, name)
      skillSet.set(key, { value: name, label: name, sublabel: 'Popular', count, type: 'skill' })
    }
    cache.skill = Array.from(skillSet.values()).sort((a, b) => b.count - a.count)

    // ── 2. Process Locations ──
    const locMap = new Map<string, Suggestion>()
    for (const loc of LOCATION_TAXONOMY) {
      const canonical = normalizeLocation(loc)
      const key = canonical.toLowerCase()
      if (!locMap.has(key)) locMap.set(key, { value: canonical, label: canonical, count: 0, type: 'location' })
    }
    for (const row of locRes.rows) {
      if (isJunkLocation(row.location)) continue
      const canonical = normalizeLocation(row.location)
      const key = canonical.toLowerCase()
      const existing = locMap.get(key)
      if (existing) {
        existing.count += parseInt(row.count, 10)
      } else if (canonical.length <= 60) {
        locMap.set(key, { value: canonical, label: canonical, count: parseInt(row.count, 10), type: 'location' })
      }
    }
    cache.location = Array.from(locMap.values()).sort((a, b) => b.count - a.count)

    // ── 3. Process Job Titles ──
    const titleMap = new Map<string, Suggestion>()
    for (const t of JOB_TITLE_TAXONOMY) titleMap.set(t.toLowerCase(), { value: t, label: t, count: 0, type: 'job_title' })
    for (const row of titleRes.rows) {
      const t = row.title.trim()
      if (isJunkTitle(t)) continue
      const key = t.toLowerCase()
      const existing = titleMap.get(key)
      if (existing) {
        existing.count += parseInt(row.count, 10)
      } else if (parseInt(row.count, 10) >= 1) {
        titleMap.set(key, { value: t, label: t, count: parseInt(row.count, 10), type: 'job_title' })
      }
    }
    cache.job_title = Array.from(titleMap.values())
      .filter(t => { const lower = t.value.toLowerCase(); if (/datasets|kernels|votes|notebooks/.test(lower)) return false; if (t.value.length < 3) return false; if (!t.value.includes(' ') && t.count === 0) return false; return true })
      .sort((a, b) => b.count - a.count)

    // ── 4. Process Companies ──
    const compCounts = new Map<string, { value: string; count: number }>()
    for (const row of compRes.rows) {
      if (!row.company || isJunkCompany(row.company)) continue
      const normalized = normalizeText(row.company)
      if (normalized.length < 2) continue
      const key = normalized.toLowerCase()
      const existing = compCounts.get(key)
      if (existing) {
        existing.count += 1
        if (/[a-z]/.test(normalized) && !/[a-z]/.test(existing.value)) existing.value = normalized
      } else {
        compCounts.set(key, { value: normalized, count: 1 })
      }
    }
    cache.company = [...compCounts.values()].sort((a, b) => b.count - a.count).map(({ value, count }) => ({ value, label: value, count, type: 'company' as const }))

    // ── 5. Process Schools ──
    const schoolCounts = new Map<string, number>()
    for (const row of schoolRes.rows) {
      if (!row.school || isJunkSchool(row.school)) continue
      const normalized = normalizeText(row.school)
      if (normalized.length < 3) continue
      schoolCounts.set(normalized.toLowerCase(), (schoolCounts.get(normalized.toLowerCase()) || 0) + 1)
    }
    cache.school = [...schoolCounts.entries()].filter(([k]) => k.length >= 3 && k.length <= 120).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, label: value, count, type: 'school' as const }))

    // ── 6. Process Degrees ──
    const degreeCounts = new Map<string, number>()
    for (const row of degreeRes.rows) {
      if (row.degree && !isJunkDegree(row.degree)) {
        const normalized = normalizeDegree(row.degree)
        if (normalized.length >= 2) degreeCounts.set(normalized, (degreeCounts.get(normalized) || 0) + 1)
      }
    }
    cache.degree = [...degreeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, label: value, count, type: 'degree' as const }))

    // ── 7. Process Languages ──
    const langCounts = new Map<string, number>()
    for (const row of langRes.rows) {
      if (row.lang && !isJunkLanguage(row.lang)) {
        const normalized = normalizeLanguage(row.lang)
        langCounts.set(normalized.toLowerCase(), (langCounts.get(normalized.toLowerCase()) || 0) + 1)
      }
    }
    cache.language = [...langCounts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value: value.charAt(0).toUpperCase() + value.slice(1), label: value.charAt(0).toUpperCase() + value.slice(1), count, type: 'language' as const }))

    // ── 8. Process Industries ──
    cache.industry = indRes.rows.filter((r: { industry: string; count: string }) => r.industry.trim().length >= 2).map((r: { industry: string; count: string }) => ({ value: r.industry.trim(), label: r.industry.trim(), count: parseInt(r.count, 10), type: 'industry' as const }))

    // ── 9. Process Regions ──
    cache.region = regRes.rows.filter((r: { region: string; count: string }) => r.region.trim().length >= 2).map((r: { region: string; count: string }) => ({ value: r.region.trim(), label: r.region.trim(), count: parseInt(r.count, 10), type: 'region' as const }))

    cache.lastRefresh = Date.now()
    console.log(
      `[Autocomplete] Taxonomy loaded: ${cache.skill.length} skills, ${cache.location.length} locations, ${cache.job_title.length} titles, ${cache.company.length} companies, ${cache.school.length} schools, ${cache.degree.length} degrees, ${cache.language.length} languages, ${cache.industry.length} industries, ${cache.region.length} regions`
    )
  } catch (error) {
    console.error('[Autocomplete] Cache refresh failed:', error)
  }
}

// ─── Fuzzy matching helpers ────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      prev = temp
    }
  }
  return dp[n]
}

// Common abbreviations / synonyms per type
const SYNONYMS: Record<string, string[]> = {
  'dev': ['developer', 'engineer'],
  'eng': ['engineer', 'engineering'],
  'mgr': ['manager'],
  'sr': ['senior'],
  'jr': ['junior'],
  'arch': ['architect'],
  'admin': ['administrator'],
  'analyst': ['analyst', 'analytics'],
  'designer': ['designer', 'design'],
  'infra': ['infrastructure'],
  'ml': ['machine learning'],
  'ai': ['artificial intelligence'],
  'bi': ['business intelligence'],
  'pm': ['product manager', 'project manager', 'program manager'],
  'ux': ['user experience'],
  'ui': ['user interface'],
  'qa': ['quality assurance', 'testing'],
  'sre': ['site reliability'],
  'devops': ['development operations'],
  'fullstack': ['full stack'],
  'frontend': ['front end', 'front-end'],
  'backend': ['back end', 'back-end'],
  'mobile': ['mobile', 'ios', 'android'],
  'cloud': ['cloud', 'aws', 'azure', 'gcp'],
  'data': ['data', 'database'],
  'research': ['research', 'r&d'],
  'security': ['security', 'cybersecurity'],
  'network': ['network', 'networking'],
  'embedded': ['embedded', 'firmware', 'iot'],
  'hardware': ['hardware', 'electrical'],
  'software': ['software'],
  'support': ['support', 'helpdesk'],
  'technical': ['technical', 'tech'],
  'automation': ['automation', 'automated'],
  'consulting': ['consulting', 'consultant'],
  'associate': ['associate', 'junior'],
  'senior': ['senior', 'sr', 'experienced'],
  'junior': ['junior', 'jr', 'entry'],
  'lead': ['lead', 'head', 'principal'],
  'director': ['director', 'head', 'vp'],
  'vp': ['vice president', 'vp', 'executive'],
  'chief': ['chief', 'c-level'],
}

function expandSynonyms(query: string): string[] {
  const lower = query.toLowerCase().trim()
  const expansions: string[] = [lower]
  // Direct synonym match
  if (SYNONYMS[lower]) {
    expansions.push(...SYNONYMS[lower])
  }
  // Check if any word in the query is a synonym key
  const words = lower.split(/\s+/)
  for (const w of words) {
    if (SYNONYMS[w]) {
      expansions.push(...SYNONYMS[w])
    }
  }
  return expansions
}

function fuzzyScore(query: string, label: string): number {
  const q = query.toLowerCase().trim()
  const l = label.toLowerCase()
  if (!q || !l) return 0

  // Exact match — score 100
  if (l === q) return 100

  // Starts with — score 90
  if (l.startsWith(q)) return 90

  // Contains exact phrase — score 80
  if (l.includes(q)) return 80

  // Word boundary match — score 75
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`\\b${escaped}`).test(l)) return 75

  // Token-based: all query words appear in label (any order) — score 70
  const queryWords = q.split(/\s+/).filter(Boolean)
  const labelWords = l.split(/\s+/).filter(Boolean)
  if (queryWords.length > 1) {
    const allMatch = queryWords.every(qw =>
      labelWords.some(lw => lw.includes(qw) || levenshtein(qw, lw) <= Math.max(1, Math.floor(Math.min(qw.length, lw.length) * 0.3)))
    )
    if (allMatch) return 70
  }

  // Synonym match — score 65
  const expansions = expandSynonyms(q)
  for (const exp of expansions) {
    if (exp !== q && l.includes(exp)) return 65
  }

  // Any single word matches — score 55
  for (const qw of queryWords) {
    for (const lw of labelWords) {
      if (lw.includes(qw) || qw.includes(lw)) return 55
      if (levenshtein(qw, lw) <= Math.max(1, Math.floor(Math.min(qw.length, lw.length) * 0.35))) return 55
    }
  }

  // Fuzzy substring: query chars appear in order within label — score 45
  let qi = 0
  for (let li = 0; li < l.length && qi < q.length; li++) {
    if (l[li] === q[qi]) qi++
  }
  if (qi === q.length && q.length >= 3) return 45

  // Levenshtein distance on full strings — score 35 if close enough
  const dist = levenshtein(q, l)
  const maxLen = Math.max(q.length, l.length)
  if (maxLen <= 2) return 0
  if (dist <= Math.floor(maxLen * 0.35)) return 35

  // Fuzzy word-level: any word in label is close to any query word — score 30
  for (const qw of queryWords) {
    for (const lw of labelWords) {
      if (qw.length >= 2 && lw.length >= 2) {
        const d = levenshtein(qw, lw)
        const ml = Math.max(qw.length, lw.length)
        if (d <= Math.floor(ml * 0.4)) return 30
      }
    }
  }

  return 0
}

// ─── Routes ───────────────────────────────────────────────────

autocompleteRouter.get('/', async (req: Request, res: Response) => {
  try {
    const type = (req.query.type as string) || 'skill'
    const q = ((req.query.q as string) || '').trim().toLowerCase()
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 20)

    if (Date.now() - cache.lastRefresh > REFRESH_MS) {
      refreshCache()
    }

    const items: Suggestion[] = cache[type as keyof typeof cache] as Suggestion[] || cache.skill

    // Empty query → return top items by count
    if (!q || q.length < 1) {
      const top = [...items].sort((a, b) => b.count - a.count).slice(0, limit)
      res.json({ suggestions: top })
      return
    }

    // Score every item using fuzzy matching
    const scored: Array<{ item: Suggestion; score: number }> = []
    for (const item of items) {
      const score = fuzzyScore(q, item.label)
      if (score > 0) {
        scored.push({ item, score })
      }
    }

    // Sort by score desc, then by count desc as tiebreaker
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.item.count - a.item.count
    })

    const results = scored.slice(0, limit).map(s => s.item)
    res.json({ suggestions: results })
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
      skills: cache.skill.length,
      locations: cache.location.length,
      jobTitles: cache.job_title.length,
    },
  })
})

// ─── Initial load ─────────────────────────────────────────────
refreshCache()
