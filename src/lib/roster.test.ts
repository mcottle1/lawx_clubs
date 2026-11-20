import { describe, expect, it } from 'vitest'
import { diffRoster, parseRoster } from './roster'

describe('parseRoster', () => {
  it('reads Name/Email headers in any order and an optional Role column', () => {
    const r = parseRoster('Email,Full Name,Position\nann@byu.edu,Ann Lee,President\nbo@byu.edu,Bo Park,\n')
    expect(r.hasHeader).toBe(true)
    expect(r.hasRoleColumn).toBe(true)
    expect(r.members).toEqual([
      { name: 'Ann Lee', email: 'ann@byu.edu', role: 'President', line: 2 },
      { name: 'Bo Park', email: 'bo@byu.edu', role: null, line: 3 },
    ])
  })

  it('joins First name + Last name', () => {
    const r = parseRoster('First Name,Last Name,E-mail\r\nAnn,Lee,ann@byu.edu\r\n')
    expect(r.members[0]).toMatchObject({ name: 'Ann Lee', email: 'ann@byu.edu' })
  })

  it('detects the email column without a header', () => {
    const r = parseRoster('Ann Lee,ann@byu.edu,2L\n"Park, Bo",bo@byu.edu,1L\n')
    expect(r.hasHeader).toBe(false)
    expect(r.members.map((m) => m.name)).toEqual(['Ann Lee', 'Park, Bo'])
    // An address like someone@email.com isn't mistaken for an "Email" header.
    expect(parseRoster('Cy,cy@email.com\n').members).toEqual([{ name: 'Cy', email: 'cy@email.com', role: null, line: 1 }])
  })

  it('reports invalid, missing and duplicate rows', () => {
    const r = parseRoster('Name,Email\nAnn,ann@byu.edu\nBo,not-an-email\n,cy@byu.edu\nDup,ANN@byu.edu\nEd,\n')
    expect(r.members).toHaveLength(1)
    expect(r.problems.map((p) => [p.line, p.reason])).toEqual([
      [3, 'Not a valid email'], [4, 'Missing name'], [5, 'Duplicate email in this file'], [6, 'Missing email'],
    ])
  })

  it('explains when there is no email column', () => {
    const r = parseRoster('Name,Year\nAnn,2L\n')
    expect(r.members).toHaveLength(0)
    expect(r.problems[0].reason).toMatch(/No email column/)
  })
})

describe('diffRoster', () => {
  const existing = [
    { id: '1', name: 'Ann Lee', email: 'Ann@byu.edu', role: 'President' },
    { id: '2', name: 'Bo Park', email: 'bo@byu.edu', role: null },
    { id: '3', name: 'Cy Diaz', email: 'cy@byu.edu', role: null },
  ]
  it('matches by email (case-insensitive) and finds adds, updates and members not in the file', () => {
    const { members } = parseRoster('Name,Email,Role\nAnn Lee,ann@byu.edu,\nBo Park-Kim,bo@byu.edu,Treasurer\nDee,dee@byu.edu,\n')
    const d = diffRoster(existing, members, true)
    expect(d.toAdd.map((m) => m.email)).toEqual(['dee@byu.edu'])
    expect(d.toUpdate).toEqual([{ id: '2', name: 'Bo Park-Kim', role: 'Treasurer', before: existing[1] }])
    expect(d.unchanged).toBe(1) // Ann keeps her role: a blank role cell doesn't clear it
    expect(d.notInFile.map((m) => m.id)).toEqual(['3'])
  })
  it('ignores roles when not importing them', () => {
    const { members } = parseRoster('Name,Email,Role\nBo Park,bo@byu.edu,Treasurer\n')
    const d = diffRoster(existing, members, false)
    expect(d.toUpdate).toHaveLength(0)
    expect(d.unchanged).toBe(1)
  })
})

describe('roster download', () => {
  it('re-imports to the same members, and neutralizes spreadsheet formulas', async () => {
    const { toCsv } = await import('./csv')
    const csv = toCsv([
      ['Name', 'Email', 'Role', 'Joined'],
      ['Park, Bo', 'bo@byu.edu', 'Treasurer', '2026-09-01'],
      ['Ann "AJ" Lee', 'ann@byu.edu', '', '2026-09-02'],
      ['=HYPERLINK("x")', 'cy@byu.edu', '', '2026-09-03'],
    ])
    const r = parseRoster(csv)
    expect(r.members.map((m) => [m.name, m.email, m.role])).toEqual([
      ['Park, Bo', 'bo@byu.edu', 'Treasurer'],
      ['Ann "AJ" Lee', 'ann@byu.edu', null],
      ["'=HYPERLINK(\"x\")", 'cy@byu.edu', null],
    ])
  })
})
