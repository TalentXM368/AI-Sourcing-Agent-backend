import type { CandidateProfile } from '../../../candidate-intelligence/types/profile.types.js';
import { createCandidateProfile } from '../fixtures/candidate.factory.js';

const FIRST_NAMES = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Christopher', 'Karen', 'Charles', 'Lisa', 'Daniel', 'Nancy', 'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Amit', 'Priya', 'Raj', 'Sneha', 'Wei', 'Fang', 'Hiroshi', 'Yuki'];

const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Hernandez', 'Moore', 'Martin', 'Jackson', 'Thompson', 'White', 'Lopez', 'Patel', 'Kumar', 'Sharma', 'Singh', 'Wang', 'Li', 'Zhang', 'Chen', 'Tanaka', 'Kim'];

const CITIES = [
  { city: 'San Francisco', state: 'California', country: 'USA' },
  { city: 'New York', state: 'New York', country: 'USA' },
  { city: 'Seattle', state: 'Washington', country: 'USA' },
  { city: 'Austin', state: 'Texas', country: 'USA' },
  { city: 'Boston', state: 'Massachusetts', country: 'USA' },
  { city: 'Pune', state: 'Maharashtra', country: 'India' },
  { city: 'Bangalore', state: 'Karnataka', country: 'India' },
  { city: 'Hyderabad', state: 'Telangana', country: 'India' },
  { city: 'Mumbai', state: 'Maharashtra', country: 'India' },
  { city: 'London', state: null, country: 'UK' },
  { city: 'Toronto', state: 'Ontario', country: 'Canada' },
  { city: 'Berlin', state: null, country: 'Germany' },
  { city: 'Singapore', state: null, country: 'Singapore' },
  { city: 'Sydney', state: 'NSW', country: 'Australia' },
];

const SKILL_POOLS = {
  programming: ['Python', 'TypeScript', 'JavaScript', 'Java', 'Go', 'Rust', 'C++', 'C#', 'Ruby', 'PHP', 'Swift', 'Kotlin'],
  framework: ['React', 'Angular', 'Vue.js', 'Node.js', 'FastAPI', 'Django', 'Flask', 'Spring Boot', 'Express.js', 'Next.js', 'NestJS', 'Rails'],
  database: ['PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch', 'DynamoDB', 'Cassandra', 'Neo4j'],
  cloud: ['AWS', 'GCP', 'Azure', 'DigitalOcean', 'Heroku', 'Vercel'],
  devops: ['Docker', 'Kubernetes', 'Jenkins', 'GitHub Actions', 'Terraform', 'Ansible', 'Prometheus', 'Grafana'],
  ai: ['TensorFlow', 'PyTorch', 'Scikit-learn', 'Hugging Face', 'LangChain', 'OpenAI API', 'LlamaIndex'],
  data: ['Pandas', 'NumPy', 'Spark', 'Airflow', 'dbt', 'Snowflake', 'BigQuery', 'Redshift'],
  mobile: ['React Native', 'Flutter', 'iOS', 'Android', 'SwiftUI', 'Jetpack Compose'],
};

const COMPANIES = ['Google', 'Microsoft', 'Amazon', 'Meta', 'Apple', 'Netflix', 'Stripe', 'Airbnb', 'Uber', 'Shopify', 'Atlassian', 'Salesforce', 'Oracle', 'IBM', 'Adobe', 'VMware', 'Twilio', 'Cloudflare', 'Snowflake', 'Databricks', 'TechCorp', 'StartupInc', 'InnovateLab', 'DataFlow', 'CloudNative'];

const UNIVERSITIES = ['MIT', 'Stanford', 'CMU', 'UC Berkeley', 'Georgia Tech', 'IIT Bombay', 'IIT Delhi', 'IISc', 'University of Toronto', 'ETH Zurich', 'University of Cambridge', 'University of Oxford', 'NUS', 'University of Melbourne'];

const DEGREES = ['Bachelor', 'Master', 'PhD'];
const SPECIALIZATIONS = ['Computer Science', 'Software Engineering', 'Information Technology', 'Data Science', 'Electrical Engineering', 'Mathematics', 'Physics'];

const INDUSTRIES = ['Technology', 'Healthcare', 'Finance', 'Education', 'Retail', 'Manufacturing', 'Media', 'Energy', 'Consulting', 'Logistics'];

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function pickN<T>(arr: T[], count: number, seed: number): T[] {
  const result: T[] = [];
  for (let i = 0; i < count; i++) {
    result.push(arr[(seed + i * 7) % arr.length]);
  }
  return [...new Set(result)];
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

export interface CandidateDatasetOptions {
  count: number;
  experienceLevel?: 'fresher' | 'mid' | 'senior' | 'leadership' | 'mixed';
  industry?: string;
  country?: string;
  seed?: number;
}

export function generateCandidateProfiles(options: CandidateDatasetOptions): CandidateProfile[] {
  const { count, experienceLevel = 'mixed', seed = 42 } = options;
  const profiles: CandidateProfile[] = [];

  for (let i = 0; i < count; i++) {
    const s = seed + i;
    const firstName = pick(FIRST_NAMES, s);
    const lastName = pick(LAST_NAMES, s + 1);
    const location = pick(CITIES, s + 2);
    const industry = pick(INDUSTRIES, s + 3);

    let yearsExp: number;
    let seniority: string;
    let jobTitle: string;

    if (experienceLevel === 'fresher') {
      yearsExp = (s % 2);
      seniority = 'junior';
      jobTitle = 'Software Engineer';
    } else if (experienceLevel === 'mid') {
      yearsExp = 3 + (s % 4);
      seniority = 'mid';
      jobTitle = 'Software Engineer';
    } else if (experienceLevel === 'senior') {
      yearsExp = 7 + (s % 6);
      seniority = 'senior';
      jobTitle = 'Senior Software Engineer';
    } else if (experienceLevel === 'leadership') {
      yearsExp = 12 + (s % 8);
      seniority = 'lead';
      jobTitle = 'Engineering Manager';
    } else {
      yearsExp = (s % 15);
      seniority = yearsExp < 2 ? 'junior' : yearsExp < 6 ? 'mid' : yearsExp < 10 ? 'senior' : 'lead';
      jobTitle = seniority === 'junior' ? 'Software Engineer' : seniority === 'mid' ? 'Software Engineer' : seniority === 'senior' ? 'Senior Software Engineer' : 'Engineering Manager';
    }

    const skills = pickN(SKILL_POOLS.programming, 2 + (s % 3), s + 10)
      .concat(pickN(SKILL_POOLS.framework, 1 + (s % 2), s + 20))
      .concat(pickN(SKILL_POOLS.database, 1, s + 30))
      .concat(pickN(SKILL_POOLS.cloud, 1, s + 40));

    const expEntries = [];
    let remainingMonths = yearsExp * 12;
    let startYear = 2024 - yearsExp;

    while (remainingMonths > 0) {
      const durationMonths = Math.min(remainingMonths, 18 + (s % 24));
      const company = pick(COMPANIES, s + startYear);
      expEntries.push({
        company: sf(company),
        title: sf(jobTitle),
        employmentType: sf('full-time'),
        startDate: sf(`${startYear}-01`),
        endDate: remainingMonths === durationMonths ? null : sf(`${startYear + Math.floor(durationMonths / 12)}-${String((durationMonths % 12) + 1).padStart(2, '0')}`),
        isCurrent: remainingMonths === durationMonths,
        durationMonths,
        responsibilities: ['Built scalable systems', 'Led feature development'],
      });
      remainingMonths -= durationMonths;
      startYear += Math.floor(durationMonths / 12);
    }

    const degree = pick(DEGREES, s + 50);
    const specialization = pick(SPECIALIZATIONS, s + 51);
    const university = pick(UNIVERSITIES, s + 52);

    profiles.push(createCandidateProfile({
      candidateId: `bench-candidate-${String(i + 1).padStart(4, '0')}`,
      personal: {
        name: sf(`${firstName} ${lastName}`),
        headline: sf(`${seniority.charAt(0).toUpperCase() + seniority.slice(1)} ${jobTitle}`),
        summary: `${seniority.charAt(0).toUpperCase() + seniority.slice(1)} ${jobTitle.toLowerCase()} with ${yearsExp} years of experience in ${industry.toLowerCase()}.`,
      },
      contact: {
        email: sf(`${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`),
        phone: sf(`+1-555-${String(1000 + i).padStart(4, '0')}`),
        linkedin: null,
        github: null,
        portfolio: null,
        website: null,
        city: sf(location.city),
        state: location.state ? sf(location.state) : null,
        country: sf(location.country),
      },
      skills: skills.map(s => ({ canonical: s, raw: s, category: 'other', confidence: { score: 0.85, reasons: [] } })),
      experience: expEntries,
      education: [{
        degree: sf(degree),
        specialization: sf(specialization),
        university: sf(university),
        graduationYear: sf(String(2024 - yearsExp - 4)),
        educationLevel: sf(degree.toLowerCase() + 's'),
      }],
    }));
  }

  return profiles;
}
