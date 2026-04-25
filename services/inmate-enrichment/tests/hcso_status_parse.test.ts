import { parseStatusFromHtml } from '../worker/src/providers/hcsoClient';

describe('HCSO status parser', () => {
  it('detects not in jail and as-of timestamp', () => {
    const html = `<table align="CENTER" border="0" bgcolor="WHITE"><tbody><tr align="CENTER"><td><strong><font face="ARIAL" size="-1" color="#FF0000"><p>CASTILLO, OSCAR(03308783) IS NOT IN JAIL</p></font></strong></td></tr></tbody></table>
    <table align="CENTER" border="0" bgcolor="WHITE"><tbody><tr align="CENTER"><td><strong><font face="ARIAL" size="-1"><p>INFORMATION ACCURATE AS OF 10/16/2025 - 15:00</p></font></strong></td></tr></tbody></table>`;
    const { notInJail, asOf, statusMessage } = parseStatusFromHtml(html);
    expect(notInJail).toBe(true);
    expect(asOf).toContain('10/16/2025');
    expect(statusMessage?.toUpperCase()).toContain('NOT IN JAIL');
  });
});
