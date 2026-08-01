import type { JobProfile } from '../../../job-intelligence/types/profile.types.js';
import { createJobProfile } from '../fixtures/job.factory.js';

const JOB_TITLES = [
  'Software Engineer', 'Senior Software Engineer', 'Backend Engineer', 'Frontend Engineer',
  'Full Stack Engineer', 'AI Engineer', 'ML Engineer', 'Data Scientist', 'Data Engineer',
  'DevOps Engineer', 'SRE', 'Platform Engineer', 'QA Engineer', 'SDET',
  'Cloud Architect', 'Security Engineer', 'Mobile Engineer', 'iOS Engineer', 'Android Engineer',
  'Engineering Manager', 'VP of Engineering', 'CTO', 'Product Manager', 'Scrum Master',
  'HR Manager', 'Marketing Manager', 'Sales Manager', 'Business Analyst', 'Financial Analyst',
];

const COMPANIES = ['TechCorp', 'DataFlow', 'CloudNative', 'InnovateLab', 'HealthTech', 'FinServe', 'EduPlatform', 'RetailPro', 'MediaHub', 'EnergyPlus'];

const CITIES = [
  { city: 'San Francisco', state: 'California', country: 'USA' },
  { city: 'New York', state: 'New York', country: 'USA' },
  { city: 'Seattle', state: 'Washington', country: 'USA' },
  { city: 'Austin', state: 'Texas', country: 'USA' },
  { city: 'Pune', state: 'Maharashtra', country: 'India' },
  { city: 'Bangalore', state: 'Karnataka', country: 'India' },
  { city: 'London', state: null, country: 'UK' },
  { city: 'Toronto', state: 'Ontario', country: 'Canada' },
  { city: 'Berlin', state: null, country: 'Germany' },
  { city: 'Remote', state: null, country: 'Global' },
];

const INDUSTRIES = ['Technology', 'Healthcare', 'Finance', 'Education', 'Retail', 'Manufacturing', 'Media', 'Energy'];

const SENIORITY_MAP: Record<string, string> = {
  'Software Engineer': 'mid',
  'Senior Software Engineer': 'senior',
  'Staff Engineer': 'senior',
  'Principal Engineer': 'principal',
  'Engineering Manager': 'lead',
  'VP of Engineering': 'vp',
  'CTO': 'c-level',
};

const SKILL_REQUIREMENTS: Record<string, { required: string[]; preferred: string[] }> = {
  'Software Engineer': { required: ['Python', 'JavaScript', 'Git'], preferred: ['Docker', 'AWS', 'React'] },
  'Senior Software Engineer': { required: ['Python', 'TypeScript', 'PostgreSQL', 'AWS'], preferred: ['Kubernetes', 'Redis', 'GraphQL'] },
  'Backend Engineer': { required: ['Python', 'FastAPI', 'PostgreSQL', 'Docker'], preferred: ['AWS', 'Redis', 'Kubernetes'] },
  'Frontend Engineer': { required: ['TypeScript', 'React', 'CSS'], preferred: ['Next.js', 'GraphQL', 'Testing Library'] },
  'Full Stack Engineer': { required: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'], preferred: ['Docker', 'AWS', 'Redis'] },
  'AI Engineer': { required: ['Python', 'PyTorch', 'TensorFlow', 'SQL'], preferred: ['LangChain', 'OpenAI API', 'MLflow'] },
  'ML Engineer': { required: ['Python', 'Scikit-learn', 'Pandas', 'SQL'], preferred: ['Spark', 'Airflow', 'Kubeflow'] },
  'Data Scientist': { required: ['Python', 'Pandas', 'NumPy', 'SQL'], preferred: ['R', 'Tableau', 'Power BI'] },
  'Data Engineer': { required: ['Python', 'SQL', 'Spark', 'Airflow'], preferred: ['dbt', 'Snowflake', 'Kafka'] },
  'DevOps Engineer': { required: ['Linux', 'Docker', 'Kubernetes', 'Terraform'], preferred: ['AWS', 'Ansible', 'Prometheus'] },
  'SRE': { required: ['Linux', 'Python', 'Kubernetes', 'Prometheus'], preferred: ['Terraform', 'Grafana', 'ELK'] },
  'Platform Engineer': { required: ['Kubernetes', 'Docker', 'Go', 'Terraform'], preferred: ['AWS', 'ArgoCD', 'Helm'] },
  'QA Engineer': { required: ['Python', 'Selenium', 'Postman'], preferred: ['Cypress', 'Jest', 'CI/CD'] },
  'SDET': { required: ['TypeScript', 'Playwright', 'Jest', 'CI/CD'], preferred: ['Docker', 'API Testing', 'Performance Testing'] },
  'Cloud Architect': { required: ['AWS', 'Terraform', 'Kubernetes'], preferred: ['Azure', 'GCP', 'Security'] },
  'Security Engineer': { required: ['Python', 'Linux', 'OWASP', 'SIEM'], preferred: ['Kubernetes', 'Terraform', 'Penetration Testing'] },
  'Mobile Engineer': { required: ['React Native', 'TypeScript'], preferred: ['iOS', 'Android', 'Firebase'] },
  'iOS Engineer': { required: ['Swift', 'UIKit', 'SwiftUI'], preferred: ['Core Data', 'Combine', 'CI/CD'] },
  'Android Engineer': { required: ['Kotlin', 'Jetpack Compose', 'Android SDK'], preferred: ['Room', 'Hilt', 'Coroutines'] },
  'Engineering Manager': { required: ['Team Leadership', 'Agile', 'System Design'], preferred: ['Budgeting', 'Hiring', 'Strategy'] },
  'VP of Engineering': { required: ['Leadership', 'Strategy', 'Budgeting'], preferred: ['Technical Architecture', 'Hiring', 'M&A'] },
  'CTO': { required: ['Technical Strategy', 'Leadership', 'Architecture'], preferred: ['Fundraising', 'Product Strategy', 'M&A'] },
  'Product Manager': { required: ['Agile', 'User Research', 'Roadmapping'], preferred: ['SQL', 'A/B Testing', 'Analytics'] },
  'Scrum Master': { required: ['Agile', 'Scrum', 'Facilitation'], preferred: ['Jira', 'Coaching', 'Conflict Resolution'] },
  'HR Manager': { required: ['Recruitment', 'Employee Relations', 'Compliance'], preferred: ['HRIS', 'Compensation', 'Training'] },
  'Marketing Manager': { required: ['Digital Marketing', 'SEO', 'Analytics'], preferred: ['Content Strategy', 'Social Media', 'Email Marketing'] },
  'Sales Manager': { required: ['Sales Strategy', 'CRM', 'Negotiation'], preferred: ['Salesforce', 'Pipeline Management', 'Forecasting'] },
  'Business Analyst': { required: ['Requirements Gathering', 'SQL', 'Process Mapping'], preferred: ['Jira', 'Confluence', 'Data Analysis'] },
  'Financial Analyst': { required: ['Financial Modeling', 'Excel', 'SQL'], preferred: ['Python', 'Tableau', 'Bloomberg'] },
};

const WORK_MODES = ['remote', 'hybrid', 'onsite'];
const EMPLOYMENT_TYPES = ['full-time', 'contract'];

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function sf(value: string) {
  return {
    raw: value,
    value,
    extractor: 'benchmark-generator',
    sourceSection: 'benchmark',
    confidence: { score: 0.9, reasons: [] },
  };
}

export interface JobDatasetOptions {
  count: number;
  category?: 'software' | 'ai-ml' | 'devops' | 'healthcare' | 'business' | 'qa' | 'mixed';
  seed?: number;
}

const CATEGORY_MAP: Record<string, string[]> = {
  'software': ['Software Engineer', 'Senior Software Engineer', 'Backend Engineer', 'Frontend Engineer', 'Full Stack Engineer'],
  'ai-ml': ['AI Engineer', 'ML Engineer', 'Data Scientist', 'Data Engineer'],
  'devops': ['DevOps Engineer', 'SRE', 'Platform Engineer', 'Cloud Architect', 'Security Engineer'],
  'healthcare': ['Software Engineer', 'Data Engineer', 'Backend Engineer'],
  'business': ['HR Manager', 'Marketing Manager', 'Sales Manager', 'Business Analyst', 'Financial Analyst', 'Product Manager', 'Scrum Master'],
  'qa': ['QA Engineer', 'SDET'],
  'mixed': JOB_TITLES,
};

export function generateJobProfiles(options: JobDatasetOptions): JobProfile[] {
  const { count, category = 'mixed', seed = 42 } = options;
  const titles = CATEGORY_MAP[category] || JOB_TITLES;
  const profiles: JobProfile[] = [];

  for (let i = 0; i < count; i++) {
    const s = seed + i;
    const title = pick(titles, s);
    const company = pick(COMPANIES, s + 1);
    const location = pick(CITIES, s + 2);
    const industry = pick(INDUSTRIES, s + 3);
    const workMode = pick(WORK_MODES, s + 4);
    const employmentType = pick(EMPLOYMENT_TYPES, s + 5);
    const seniority = SENIORITY_MAP[title] || 'mid';
    const skillReq = SKILL_REQUIREMENTS[title] || { required: ['Python', 'Git'], preferred: ['Docker'] };

    const yearsExp = seniority === 'junior' ? '0-2' : seniority === 'mid' ? '3-5' : seniority === 'senior' ? '5-10' : '10+';
    const [minYears, maxYears] = yearsExp.split('-').map(y => y.replace('+', ''));

    profiles.push(createJobProfile({
      jobId: `bench-job-${String(i + 1).padStart(4, '0')}`,
      title: sf(title),
      summary: sf(`Looking for a ${title.toLowerCase()} with ${skillReq.required.slice(0, 2).join(' and ')} experience.`),
      company: sf(company),
      industry: sf(industry),
      employmentType: sf(employmentType),
      workMode: sf(workMode),
      seniority: sf(seniority),
      experience: {
        minimumYears: sf(minYears),
        maximumYears: maxYears ? sf(maxYears) : null,
        preferredYears: null,
      },
      requiredSkills: skillReq.required.map(s => ({ canonical: s, raw: s, category: 'other', confidence: 0.9 })),
      preferredSkills: skillReq.preferred.map(s => ({ canonical: s, raw: s, category: 'other', confidence: 0.7 })),
      location: {
        city: sf(location.city),
        state: location.state ? sf(location.state) : null,
        country: sf(location.country),
        raw: sf(`${location.city}${location.state ? ', ' + location.state : ''} (${workMode})`),
      },
    }));
  }

  return profiles;
}
