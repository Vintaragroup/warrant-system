import { parseDobFromHtml } from '../worker/src/providers/hcsoClient';

describe('HCSO DOB HTML parser', () => {
  it('extracts DOB from table format', () => {
    const html = `
      <table>
        <tr><td>NAME</td><td>VILLARREAL, LUIS</td></tr>
        <tr><td>SPN</td><td>03309311</td></tr>
        <tr><td>DOB</td><td>03/16/2000</td></tr>
      </table>
    `;
    const { dob, name } = parseDobFromHtml(html);
    expect(dob).toBe('03/16/2000');
    expect(name?.toLowerCase()).toContain('villarreal');
  });

  it('extracts DOB near text label', () => {
    const html = `<div>some content DOB: 10/14/1995 more content</div>`;
    const { dob } = parseDobFromHtml(html);
    expect(dob).toBe('10/14/1995');
  });

  it('returns undefined when not present', () => {
    const { dob } = parseDobFromHtml('<div>No matching data</div>');
    expect(dob).toBeUndefined();
  });

  it('extracts DOB from nested table cells with fonts', () => {
    const html = `<div align="CENTER"><table style="FONT-FAMILY:ARIAL;FONT-SIZE:10PT" border="1" width="80%" bgcolor="#C0C0C0"><tbody><tr><td align="LEFT" width="72"><b>NAME</b></td><td width="208" height="19"><strong><font color="#FF0000">MURPHY, MYA RENEA</font></strong></td><td align="LEFT" width="49"><b>SPN</b></td><td width="66"><strong><font color="#FF0000">03243539</font></strong></td><td align="LEFT" width="67"><b>DOB</b></td><td width="104"><strong><font color="#FF0000">01/24/2005</font></strong></td></tr></tbody></table></div>`;
    const { dob, name } = parseDobFromHtml(html);
    expect(dob).toBe('01/24/2005');
    expect((name || '').toLowerCase()).toContain('murphy');
  });
});
