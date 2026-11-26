import { describe, expect, it } from 'vitest'
import { isPlaceName, looksLikePersonName, parseResumeDeterministic } from './deterministic-resume-parser.js'
import { parseResumeOffline, isExtremeParseFailure } from './resume-parser.js'

const US_RESUME = `SOWMINI SURAM
Senior Data Engineer
sowmini454@gmail.com | Phone:(240) 385-9013
Dallas, TX

Professional Summary
Data engineer with 8+ years of experience building pipelines on AWS and Spark.

Technical Skills
Python, SQL, Apache Spark, AWS, Airflow, Snowflake

Professional Experience
Capital One | Dallas, TX
Senior Data Engineer                                   Jan 2020 - Present
• Built streaming pipelines with Kafka and Spark
Infosys Limited
Data Engineer                                           Jun 2016 - Dec 2019
• Migrated ETL jobs to Airflow

Education
Master of Science in Computer Science
University of North Texas, 2016
`

const INDIA_RESUME = `RAVI TEJA
Java Full Stack Developer
Email: ravi.teja@example.com   Mobile: +91 98765 43210
Hyderabad, Telangana

PROFILE SUMMARY
5 years of experience in Java, Spring Boot and React.

WORK EXPERIENCE
Tata Consultancy Services, Hyderabad          Jul 2019 – Till Date
Role: Senior Software Engineer
- Developed REST APIs using Spring Boot

EDUCATION
B.Tech in Electronics, JNTU Hyderabad, 2019
`

describe('parseResumeDeterministic', () => {
  it('reads name, contact and location from the header', () => {
    const p = parseResumeDeterministic(US_RESUME)
    expect(p.name).toBe('Sowmini Suram')
    expect(p.email).toBe('sowmini454@gmail.com')
    expect(p.phone).toBe('(240) 385-9013')
    expect(p.location).toBe('Dallas, TX')
  })

  it('accepts international and +1 phone formats but not year runs', () => {
    expect(parseResumeDeterministic(INDIA_RESUME).phone?.replace(/\D/g, '')).toBe('919876543210')
    expect(parseResumeDeterministic('JOHN DOE\nPh. No +1 (317) 763-2462 || LinkedIn').phone).toBe('+1 (317) 763-2462')
    expect(parseResumeDeterministic('JOHN DOE\nWorked 2015 2016 2017 2018 at Acme').phone).toBeUndefined()
  })

  it('anchors work history on date ranges', () => {
    const p = parseResumeDeterministic(US_RESUME)
    expect(p.work_history.length).toBe(2)
    expect(p.work_history[0]).toMatchObject({ company: 'Capital One', title: 'Senior Data Engineer', is_current: true })
    expect(p.work_history[1].company).toMatch(/Infosys/)
    expect(p.experience_years).toBe(8)
  })

  it('takes an explicit Role: line as the title', () => {
    const p = parseResumeDeterministic(INDIA_RESUME)
    expect(p.work_history[0].title).toBe('Senior Software Engineer')
    expect(p.work_history[0].company).toMatch(/Tata Consultancy Services/)
  })

  it('finds jobs outside a cut-short Experience section, with two-digit years and label lines', () => {
    const text = `JOHN SMITH
john@x.com | 555-123-4567
WORK EXPERIENCE
Dynamics Expert Solutions Consulting Group
D365 Senior Functional Consultant (2021-2024)
TECHNICAL SKILLS
Development Collaboration Tools:
Visual Studio, JIRA
UPS – Tampa, FL, Peoria, IL (Remote)\tOctober 22 – Present
Sr C# .NET Developer/Technical lead
Responsibilities:
Built APIs.
Oscar Winski Company - Lafayette, IN
AX Administrator and SQL Architect (2018- 2020)
EDUCATION
Bachelor of Science in Computer Science, Purdue University, 2004`
    const jobs = parseResumeDeterministic(text).work_history
    expect(jobs.map(j => j.from)).toEqual(expect.arrayContaining(['2021', 'October 22', '2018']))
    const ups = jobs.find(j => j.from === 'October 22')!
    expect(ups.company).toBe('UPS')
    expect(ups.title).toMatch(/Sr C# \.NET Developer/)
    expect(jobs.some(j => /responsibilities|visual studio|development collaboration/i.test(`${j.title} ${j.company}`))).toBe(false)
  })

  it('reads Client Name: labels, Spanish months and mixed numeric dates', () => {
    const jobs = parseResumeDeterministic(`ANA PEREZ
ana@x.com | +52 55 1234 5678
PROJECT DETAILS:
Client Name:  Public Storage                    July 2020 – Till Date
Role:  QA Engineer
Técnico IT, Computación Integral S.R.L
Abr 2016 — oct 2020
APPSINVO, DELHI, IN | 03/2020 – 03-2021
Software Developer`).work_history
    const ps = jobs.find(j => j.company === 'Public Storage')
    expect(ps?.title).toBe('QA Engineer')
    expect(jobs.map(j => j.from)).toEqual(expect.arrayContaining(['Abr 2016', '03/2020']))
  })

  it('finds jobs filed under the wrong section but never turns school years into jobs', () => {
    const jobs = parseResumeDeterministic(`LEO SILVA
leo@x.com | +55 71 9999 8888
EDUCATION
ATTAINMENT
2005-2011
Elementary School
LANGUAGES
Portuguese
English
Junior System Analyst at ZCR Informática, Salvador
February 2015 — October 2016
Web Developer at Avansys, Salvador
May 2012 — February 2015`).work_history
    expect(jobs.map(j => j.from)).toEqual(expect.arrayContaining(['February 2015', 'May 2012']))
    expect(jobs.some(j => j.from === '2005')).toBe(false)
  })

  it('pairs degrees with institutions', () => {
    const p = parseResumeDeterministic(US_RESUME)
    expect(p.education[0].school).toMatch(/University of North Texas/)
    expect(p.education[0].degree).toMatch(/Master/)
  })

  it('does not return section headings as the name', () => {
    const p = parseResumeDeterministic('PROFESSIONAL SUMMARY\nExperienced analyst.\nCONTACT\nJane Smith\njane@x.com')
    expect(p.name).not.toMatch(/summary|contact/i)
  })

  it('splits a header line that the extractor glued together', () => {
    const p = parseResumeDeterministic('Venkateswarlu JyogiSr. Fullstack .Net DeveloperEmail: jv8@gmail.comPhone: +1 214-240-2866\n\nPROFESSIONAL SUMMARY:\nSenior .NET developer with 9+ years of experience.')
    expect(p.name).toBe('Venkateswarlu Jyogi')
    expect(p.email).toBe('jv8@gmail.com')
    expect(p.phone).toBe('+1 214-240-2866')
    expect(p.headline).toMatch(/Sr\. Fullstack \.Net Developer/)
  })

  it('leaves names with internal capitals alone', () => {
    expect(parseResumeDeterministic('Ronald McDonald\nronald@x.com | 555-123-4567\nSKILLS\nPython').name).toBe('Ronald McDonald')
  })

  it('never takes a location line as the name', () => {
    const p = parseResumeDeterministic('\n\nSAKSHIPATIL\nSangli,Maharashtra,India|8668703705|patilsakshi6006@gmail.com|LinkedIn|GitHub\nPROFESSIONALSUMMARY\nJava-focused engineering student.')
    expect(p.name).not.toMatch(/sangli|maharashtra|india/i)
    expect(isPlaceName('Sangli Maharashtra India')).toBe(true)
    expect(isPlaceName('Pune, India')).toBe(true)
    expect(isPlaceName('Victoria Washington')).toBe(false)
  })

  it('recognises person names and rejects headings, roles, degrees and places', () => {
    for (const ok of ['Akshat', 'Abhay Yadav', 'Ma. Divina Pael Salamanca', 'Ronald McDonald', 'HELEN DAIANA GMEZ CARO', "D'Souza Clint", 'LeelaKrishna S', 'Sunil K V', 'Sruthy J.B', 'E. Sachin Subramanian', 'Adv. Bharti Gupta', 'Lawrence Manning', 'Maria de la Cruz', 'Chandrakant']) {
      expect(looksLikePersonName(ok), ok).toBe(true)
    }
    for (const bad of ['Perfil Profesional', 'Maracaibo Venezuela', 'SeniorMicrosoftDynamics FunctionalConsultant', 'Summer Internship Training', 'MSc International Management', 'Ba Ll.B', 'Fast Learner', 'Mobile', 'Ingeniero Multimedia', 'March Present', 'Sooraj.pdf', 'English Hindi', 'Unknown', 'Team Player', 'Analytical thinking', 'Regulatory Requirements', 'Destinations Connectivity', 'GD Goenka Public School', 'multiple viewpoints.', 'Acerca de mi', 'Name Mayur Kothawade', 'jagtap.chandrakant gmail.com', 'IKAP Technology', 'Pachuca Mayo-Noviembre', 'Relevant Coursework Human Behavior']) {
      expect(looksLikePersonName(bad), bad).toBe(false)
    }
  })

  it('drops prose, places and education lines from a skills list', () => {
    const skills = parseResumeDeterministic(`JANE DOE
jane@x.com | 9876543210
SKILLS
possess excellent communication, Ramco ERP, analyzing requirements, Lucena City, BS in Computer Science, honor, deployed link—https, SAP MM, Python
EXPERIENCE
Analyst | Acme Corp | Jan 2020 - Present`).skills.map(s => s.name)
    expect(skills).toEqual(expect.arrayContaining(['python', 'ramco erp', 'sap mm']))
    for (const junk of ['possess excellent communication', 'analyzing requirements', 'lucena city', 'bs in computer science', 'honor', 'deployed link—https']) {
      expect(skills).not.toContain(junk)
    }
  })

  it('does not pick ambiguous one-letter skills from prose', () => {
    const skills = parseResumeDeterministic(US_RESUME).skills.map(s => s.name)
    expect(skills).not.toContain('r')
    expect(skills).not.toContain('go')
  })
})

describe('parseResumeOffline', () => {
  it('produces a usable profile without any LLM', () => {
    const p = parseResumeOffline(INDIA_RESUME)
    expect(isExtremeParseFailure(p)).toBe(false)
    expect(p.name).toBe('Ravi Teja')
  })
})
