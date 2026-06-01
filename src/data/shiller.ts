// AUTO-GENERATED DATA ASSET — do not hand-edit individual rows.
//
// Robert J. Shiller, "U.S. Stock Markets 1871-Present and CAPE Ratio",
// http://www.econ.yale.edu/~shiller/data.htm  (file: data/ie_data.xls).
// Shiller's long-running, widely-used public dataset, compiled by him from
// public sources (S&P Composite prices/dividends, BLS CPI-U spliced to
// Warren-Pearson pre-1913, and long-term government bond returns).
//
// Retrieved: 2026-06-01. Source workbook: ie_data.xls last saved 2023-09-17 (file metadata); series ends 2023.09.
// The current data.htm page links the main monthly file as ie_data.xls and
// carries Shiller's standard "no guarantee of accuracy/completeness"
// disclaimer; it is provided for research/educational use.
//
// DERIVATION (annual, calendar-year, anchored to each January):
//   cpi                 = January CPI index level for the year (col 'CPI').
//   sp500RealReturn     = RealTRP[Jan y+1]/RealTRP[Jan y] - 1, using Shiller's
//                         own 'Real Total Return Price' index (dividends
//                         reinvested, CPI-deflated).
//   sp500NominalReturn  = real return re-inflated by CPI[Jan y+1]/CPI[Jan y].
//   tenYearTreasuryReturn = product of Shiller's 12 monthly 'Monthly Total
//                         Bond Returns' factors across the year, minus 1
//                         (nominal long-government-bond total return).
// Because Shiller's prices are monthly averages, these annual figures track
// but do not exactly equal calendar close-to-close index returns; deviations
// are within ~a few points (see the anchor tests).
//
// Coverage: 1871-2022 (152 contiguous years). 2023 is omitted — the source
// workbook ends mid-2023, so no full-year 2023 return is available.

export interface ShillerAnnualRow {
  year: number;
  /** Nominal S&P Composite total return for the calendar year (fraction). */
  sp500NominalReturn: number;
  /** CPI-deflated (real) S&P Composite total return (fraction). */
  sp500RealReturn: number;
  /** Nominal long-term U.S. government bond total return (fraction). */
  tenYearTreasuryReturn: number;
  /** January CPI index level for the year (not a rate). */
  cpi: number;
}

export const SHILLER_DATA_AS_OF = '2026-06-01';

export const SHILLER_ANNUAL: ShillerAnnualRow[] = [
  { year: 1871, sp500NominalReturn: 0.156448, sp500RealReturn: 0.139054, tenYearTreasuryReturn: 0.051486, cpi: 12.4641 },
  { year: 1872, sp500NominalReturn: 0.112347, sp500RealReturn: 0.087812, tenYearTreasuryReturn: 0.038467, cpi: 12.6544 },
  { year: 1873, sp500NominalReturn: -0.024675, sp500RealReturn: 0.020343, tenYearTreasuryReturn: 0.065574, cpi: 12.9398 },
  { year: 1874, sp500NominalReturn: 0.047129, sp500RealReturn: 0.125008, tenYearTreasuryReturn: 0.087022, cpi: 12.3689 },
  { year: 1875, sp500NominalReturn: 0.053542, sp500RealReturn: 0.118239, tenYearTreasuryReturn: 0.089795, cpi: 11.5127 },
  { year: 1876, sp500NominalReturn: -0.141699, sp500RealReturn: -0.149164, tenYearTreasuryReturn: 0.057916, cpi: 10.8466 },
  { year: 1877, sp500NominalReturn: -0.013361, sp500RealReturn: 0.16973, tenYearTreasuryReturn: 0.054125, cpi: 10.9417 },
  { year: 1878, sp500NominalReturn: 0.162533, sp500RealReturn: 0.296151, tenYearTreasuryReturn: 0.053819, cpi: 9.2291 },
  { year: 1879, sp500NominalReturn: 0.494132, sp500RealReturn: 0.237992, tenYearTreasuryReturn: 0.059091, cpi: 8.2777 },
  { year: 1880, sp500NominalReturn: 0.266867, sp500RealReturn: 0.343652, tenYearTreasuryReturn: 0.067058, cpi: 9.9903 },
  { year: 1881, sp500NominalReturn: 0.003061, sp500RealReturn: -0.071934, tenYearTreasuryReturn: 0.044148, cpi: 9.4194 },
  { year: 1882, sp500NominalReturn: 0.03614, sp500RealReturn: 0.055872, tenYearTreasuryReturn: 0.035994, cpi: 10.1806 },
  { year: 1883, sp500NominalReturn: -0.054846, sp500RealReturn: 0.023113, tenYearTreasuryReturn: 0.037723, cpi: 9.9903 },
  { year: 1884, sp500NominalReturn: -0.123767, sp500RealReturn: -0.023055, tenYearTreasuryReturn: 0.044986, cpi: 9.2291 },
  { year: 1885, sp500NominalReturn: 0.298957, sp500RealReturn: 0.345351, tenYearTreasuryReturn: 0.048132, cpi: 8.2777 },
  { year: 1886, sp500NominalReturn: 0.1194, sp500RealReturn: 0.1194, tenYearTreasuryReturn: 0.022025, cpi: 7.9922 },
  { year: 1887, sp500NominalReturn: -0.006287, sp500RealReturn: -0.051459, tenYearTreasuryReturn: 0.023647, cpi: 7.9922 },
  { year: 1888, sp500NominalReturn: 0.032902, sp500RealReturn: 0.082091, tenYearTreasuryReturn: 0.055418, cpi: 8.3728 },
  { year: 1889, sp500NominalReturn: 0.070646, sp500RealReturn: 0.124178, tenYearTreasuryReturn: 0.037511, cpi: 7.9922 },
  { year: 1890, sp500NominalReturn: -0.061584, sp500RealReturn: -0.084472, tenYearTreasuryReturn: 0.018558, cpi: 7.6117 },
  { year: 1891, sp500NominalReturn: 0.188833, sp500RealReturn: 0.26603, tenYearTreasuryReturn: 0.038434, cpi: 7.8019 },
  { year: 1892, sp500NominalReturn: 0.06155, sp500RealReturn: -0.015189, tenYearTreasuryReturn: 0.024512, cpi: 7.3262 },
  { year: 1893, sp500NominalReturn: -0.187969, sp500RealReturn: -0.063908, tenYearTreasuryReturn: 0.042207, cpi: 7.8971 },
  { year: 1894, sp500NominalReturn: 0.035553, sp500RealReturn: 0.080576, tenYearTreasuryReturn: 0.057374, cpi: 6.8505 },
  { year: 1895, sp500NominalReturn: 0.049586, sp500RealReturn: 0.034592, tenYearTreasuryReturn: 0.023801, cpi: 6.5651 },
  { year: 1896, sp500NominalReturn: 0.032194, sp500RealReturn: 0.062553, tenYearTreasuryReturn: 0.053076, cpi: 6.6602 },
  { year: 1897, sp500NominalReturn: 0.203732, sp500RealReturn: 0.16934, tenYearTreasuryReturn: 0.038648, cpi: 6.4699 },
  { year: 1898, sp500NominalReturn: 0.293421, sp500RealReturn: 0.275203, tenYearTreasuryReturn: 0.054893, cpi: 6.6602 },
  { year: 1899, sp500NominalReturn: 0.036805, sp500RealReturn: -0.113095, tenYearTreasuryReturn: 0.027307, cpi: 6.7553 },
  { year: 1900, sp500NominalReturn: 0.209518, sp500RealReturn: 0.239383, tenYearTreasuryReturn: 0.036114, cpi: 7.8971 },
  { year: 1901, sp500NominalReturn: 0.194644, sp500RealReturn: 0.165856, tenYearTreasuryReturn: 0.024837, cpi: 7.7068 },
  { year: 1902, sp500NominalReturn: 0.082884, sp500RealReturn: -0.012315, tenYearTreasuryReturn: 0.022413, cpi: 7.8971 },
  { year: 1903, sp500NominalReturn: -0.170872, sp500RealReturn: -0.132752, tenYearTreasuryReturn: 0.025321, cpi: 8.6583 },
  { year: 1904, sp500NominalReturn: 0.321017, sp500RealReturn: 0.291338, tenYearTreasuryReturn: 0.028007, cpi: 8.2777 },
  { year: 1905, sp500NominalReturn: 0.213055, sp500RealReturn: 0.213055, tenYearTreasuryReturn: 0.039461, cpi: 8.4679 },
  { year: 1906, sp500NominalReturn: 0.006989, sp500RealReturn: -0.036322, tenYearTreasuryReturn: 0.015481, cpi: 8.4679 },
  { year: 1907, sp500NominalReturn: -0.241829, sp500RealReturn: -0.22517, tenYearTreasuryReturn: 0.021302, cpi: 8.8485 },
  { year: 1908, sp500NominalReturn: 0.394236, sp500RealReturn: 0.349742, tenYearTreasuryReturn: 0.048306, cpi: 8.6583 },
  { year: 1909, sp500NominalReturn: 0.161882, sp500RealReturn: 0.050159, tenYearTreasuryReturn: 0.026244, cpi: 8.9437 },
  { year: 1910, sp500NominalReturn: -0.033794, sp500RealReturn: 0.035938, tenYearTreasuryReturn: 0.034209, cpi: 9.8952 },
  { year: 1911, sp500NominalReturn: 0.035209, sp500RealReturn: 0.045985, tenYearTreasuryReturn: 0.038135, cpi: 9.2291 },
  { year: 1912, sp500NominalReturn: 0.071793, sp500RealReturn: -0.001045, tenYearTreasuryReturn: 0.006578, cpi: 9.134 },
  { year: 1913, sp500NominalReturn: -0.047377, sp500RealReturn: -0.06643, tenYearTreasuryReturn: 0.068626, cpi: 9.8 },
  { year: 1914, sp500NominalReturn: -0.054699, sp500RealReturn: -0.064059, tenYearTreasuryReturn: 0.036071, cpi: 10.0 },
  { year: 1915, sp500NominalReturn: 0.31219, sp500RealReturn: 0.274338, tenYearTreasuryReturn: 0.058474, cpi: 10.1 },
  { year: 1916, sp500NominalReturn: 0.082342, sp500RealReturn: -0.037918, tenYearTreasuryReturn: 0.02704, cpi: 10.4 },
  { year: 1917, sp500NominalReturn: -0.18538, sp500RealReturn: -0.31921, tenYearTreasuryReturn: 0.016719, cpi: 11.7 },
  { year: 1918, sp500NominalReturn: 0.180649, sp500RealReturn: 0.001762, tenYearTreasuryReturn: 0.05217, cpi: 14.0 },
  { year: 1919, sp500NominalReturn: 0.196281, sp500RealReturn: 0.022728, tenYearTreasuryReturn: 0.010095, cpi: 16.5 },
  { year: 1920, sp500NominalReturn: -0.139772, sp500RealReturn: -0.126189, tenYearTreasuryReturn: 0.041673, cpi: 19.3 },
  { year: 1921, sp500NominalReturn: 0.100825, sp500RealReturn: 0.237614, tenYearTreasuryReturn: 0.115626, cpi: 19.0 },
  { year: 1922, sp500NominalReturn: 0.291281, sp500RealReturn: 0.298967, tenYearTreasuryReturn: 0.03913, cpi: 16.9 },
  { year: 1923, sp500NominalReturn: 0.054573, sp500RealReturn: 0.024094, tenYearTreasuryReturn: 0.068592, cpi: 16.8 },
  { year: 1924, sp500NominalReturn: 0.271165, sp500RealReturn: 0.271165, tenYearTreasuryReturn: 0.057534, cpi: 17.3 },
  { year: 1925, sp500NominalReturn: 0.258727, sp500RealReturn: 0.216535, tenYearTreasuryReturn: 0.053943, cpi: 17.3 },
  { year: 1926, sp500NominalReturn: 0.115647, sp500RealReturn: 0.141147, tenYearTreasuryReturn: 0.065594, cpi: 17.9 },
  { year: 1927, sp500NominalReturn: 0.371595, sp500RealReturn: 0.387451, tenYearTreasuryReturn: 0.034739, cpi: 17.5 },
  { year: 1928, sp500NominalReturn: 0.476212, sp500RealReturn: 0.493477, tenYearTreasuryReturn: 0.011982, cpi: 17.3 },
  { year: 1929, sp500NominalReturn: -0.09427, sp500RealReturn: -0.09427, tenYearTreasuryReturn: 0.062317, cpi: 17.1 },
  { year: 1930, sp500NominalReturn: -0.227271, sp500RealReturn: -0.168952, tenYearTreasuryReturn: 0.029295, cpi: 17.1 },
  { year: 1931, sp500NominalReturn: -0.442641, sp500RealReturn: -0.380279, tenYearTreasuryReturn: 0.006557, cpi: 15.9 },
  { year: 1932, sp500NominalReturn: -0.061641, sp500RealReturn: 0.040196, tenYearTreasuryReturn: 0.068137, cpi: 14.3 },
  { year: 1933, sp500NominalReturn: 0.566645, sp500RealReturn: 0.53104, tenYearTreasuryReturn: 0.049436, cpi: 12.9 },
  { year: 1934, sp500NominalReturn: -0.080049, sp500RealReturn: -0.107107, tenYearTreasuryReturn: 0.059612, cpi: 13.2 },
  { year: 1935, sp500NominalReturn: 0.549564, sp500RealReturn: 0.527107, tenYearTreasuryReturn: 0.040138, cpi: 13.6 },
  { year: 1936, sp500NominalReturn: 0.327169, sp500RealReturn: 0.298932, tenYearTreasuryReturn: 0.024292, cpi: 13.8 },
  { year: 1937, sp500NominalReturn: -0.320824, sp500RealReturn: -0.325607, tenYearTreasuryReturn: 0.037347, cpi: 14.1 },
  { year: 1938, sp500NominalReturn: 0.172736, sp500RealReturn: 0.189489, tenYearTreasuryReturn: 0.043103, cpi: 14.2 },
  { year: 1939, sp500NominalReturn: 0.03057, sp500RealReturn: 0.037984, tenYearTreasuryReturn: 0.036823, cpi: 14.0 },
  { year: 1940, sp500NominalReturn: -0.088789, sp500RealReturn: -0.101714, tenYearTreasuryReturn: 0.045107, cpi: 13.9 },
  { year: 1941, sp500NominalReturn: -0.090702, sp500RealReturn: -0.183369, tenYearTreasuryReturn: -0.023256, cpi: 14.1 },
  { year: 1942, sp500NominalReturn: 0.216061, sp500RealReturn: 0.129713, tenYearTreasuryReturn: 0.024027, cpi: 15.7 },
  { year: 1943, sp500NominalReturn: 0.236215, sp500RealReturn: 0.200692, tenYearTreasuryReturn: 0.02413, cpi: 16.9 },
  { year: 1944, sp500NominalReturn: 0.19692, sp500RealReturn: 0.170023, tenYearTreasuryReturn: 0.03452, cpi: 17.4 },
  { year: 1945, sp500NominalReturn: 0.393633, sp500RealReturn: 0.363003, tenYearTreasuryReturn: 0.039542, cpi: 17.8 },
  { year: 1946, sp500NominalReturn: -0.120326, sp500RealReturn: -0.255346, tenYearTreasuryReturn: 0.01697, cpi: 18.2 },
  { year: 1947, sp500NominalReturn: 0.026345, sp500RealReturn: -0.068927, tenYearTreasuryReturn: 0.0066, cpi: 21.5 },
  { year: 1948, sp500NominalReturn: 0.095681, sp500RealReturn: 0.081985, tenYearTreasuryReturn: 0.035859, cpi: 23.7 },
  { year: 1949, sp500NominalReturn: 0.176096, sp500RealReturn: 0.201119, tenYearTreasuryReturn: 0.022489, cpi: 24.0 },
  { year: 1950, sp500NominalReturn: 0.345809, sp500RealReturn: 0.245138, tenYearTreasuryReturn: 0.002364, cpi: 23.5 },
  { year: 1951, sp500NominalReturn: 0.218857, sp500RealReturn: 0.168263, tenYearTreasuryReturn: 0.016738, cpi: 25.4 },
  { year: 1952, sp500NominalReturn: 0.146893, sp500RealReturn: 0.142581, tenYearTreasuryReturn: 0.014585, cpi: 26.5 },
  { year: 1953, sp500NominalReturn: 0.030259, sp500RealReturn: 0.01877, tenYearTreasuryReturn: 0.060252, cpi: 26.6 },
  { year: 1954, sp500NominalReturn: 0.468254, sp500RealReturn: 0.479252, tenYearTreasuryReturn: 0.012624, cpi: 26.9 },
  { year: 1955, sp500NominalReturn: 0.289401, sp500RealReturn: 0.28459, tenYearTreasuryReturn: 0.002981, cpi: 26.7 },
  { year: 1956, sp500NominalReturn: 0.068774, sp500RealReturn: 0.037795, tenYearTreasuryReturn: -0.015863, cpi: 26.8 },
  { year: 1957, sp500NominalReturn: -0.058012, sp500RealReturn: -0.090949, tenYearTreasuryReturn: 0.069256, cpi: 27.6 },
  { year: 1958, sp500NominalReturn: 0.403758, sp500RealReturn: 0.384396, tenYearTreasuryReturn: -0.043756, cpi: 28.6 },
  { year: 1959, sp500NominalReturn: 0.076476, sp500RealReturn: 0.065454, tenYearTreasuryReturn: -0.012951, cpi: 29.0 },
  { year: 1960, sp500NominalReturn: 0.065455, sp500RealReturn: 0.047578, tenYearTreasuryReturn: 0.117971, cpi: 29.3 },
  { year: 1961, sp500NominalReturn: 0.190967, sp500RealReturn: 0.183027, tenYearTreasuryReturn: 0.019236, cpi: 29.8 },
  { year: 1962, sp500NominalReturn: -0.025801, sp500RealReturn: -0.038619, tenYearTreasuryReturn: 0.061566, cpi: 30.0 },
  { year: 1963, sp500NominalReturn: 0.212324, sp500RealReturn: 0.192707, tenYearTreasuryReturn: 0.012293, cpi: 30.4 },
  { year: 1964, sp500NominalReturn: 0.160016, sp500RealReturn: 0.148862, tenYearTreasuryReturn: 0.040981, cpi: 30.9 },
  { year: 1965, sp500NominalReturn: 0.116227, sp500RealReturn: 0.095166, tenYearTreasuryReturn: 0.009144, cpi: 31.2 },
  { year: 1966, sp500NominalReturn: -0.064022, sp500RealReturn: -0.095316, tenYearTreasuryReturn: 0.052353, cpi: 31.8 },
  { year: 1967, sp500NominalReturn: 0.161221, sp500RealReturn: 0.120357, tenYearTreasuryReturn: -0.023125, cpi: 32.9 },
  { year: 1968, sp500NominalReturn: 0.106298, sp500RealReturn: 0.059684, tenYearTreasuryReturn: 0.017886, cpi: 34.1 },
  { year: 1969, sp500NominalReturn: -0.085467, sp500RealReturn: -0.138694, tenYearTreasuryReturn: -0.057115, cpi: 35.6 },
  { year: 1970, sp500NominalReturn: 0.075405, sp500RealReturn: 0.021365, tenYearTreasuryReturn: 0.199506, cpi: 37.8 },
  { year: 1971, sp500NominalReturn: 0.139945, sp500RealReturn: 0.103888, tenYearTreasuryReturn: 0.085366, cpi: 39.8 },
  { year: 1972, sp500NominalReturn: 0.178716, sp500RealReturn: 0.137212, tenYearTreasuryReturn: 0.024488, cpi: 41.1 },
  { year: 1973, sp500NominalReturn: -0.16272, sp500RealReturn: -0.234589, tenYearTreasuryReturn: 0.030163, cpi: 42.6 },
  { year: 1974, sp500NominalReturn: -0.21057, sp500RealReturn: -0.293908, tenYearTreasuryReturn: 0.039941, cpi: 46.6 },
  { year: 1975, sp500NominalReturn: 0.39199, sp500RealReturn: 0.304365, tenYearTreasuryReturn: 0.064369, cpi: 52.1 },
  { year: 1976, sp500NominalReturn: 0.112464, sp500RealReturn: 0.057316, tenYearTreasuryReturn: 0.118726, cpi: 55.6 },
  { year: 1977, sp500NominalReturn: -0.089927, sp500RealReturn: -0.148171, tenYearTreasuryReturn: 0.022166, cpi: 58.5 },
  { year: 1978, sp500NominalReturn: 0.162753, sp500RealReturn: 0.064013, tenYearTreasuryReturn: 0.008022, cpi: 62.5 },
  { year: 1979, sp500NominalReturn: 0.171702, sp500RealReturn: 0.028628, tenYearTreasuryReturn: -0.012962, cpi: 68.3 },
  { year: 1980, sp500NominalReturn: 0.260645, sp500RealReturn: 0.127335, tenYearTreasuryReturn: 0.006756, cpi: 77.8 },
  { year: 1981, sp500NominalReturn: -0.071929, sp500RealReturn: -0.143773, tenYearTreasuryReturn: 0.02753, cpi: 87.0 },
  { year: 1982, sp500NominalReturn: 0.301344, sp500RealReturn: 0.254772, tenYearTreasuryReturn: 0.431972, cpi: 94.3 },
  { year: 1983, sp500NominalReturn: 0.203866, sp500RealReturn: 0.155428, tenYearTreasuryReturn: 0.038687, cpi: 97.8 },
  { year: 1984, sp500NominalReturn: 0.079408, sp500RealReturn: 0.042575, tenYearTreasuryReturn: 0.14996, cpi: 101.9 },
  { year: 1985, sp500NominalReturn: 0.264065, sp500RealReturn: 0.216778, tenYearTreasuryReturn: 0.270573, cpi: 105.5 },
  { year: 1986, sp500NominalReturn: 0.31413, sp500RealReturn: 0.295222, tenYearTreasuryReturn: 0.2428, cpi: 109.6 },
  { year: 1987, sp500NominalReturn: -0.023768, sp500RealReturn: -0.061737, tenYearTreasuryReturn: -0.026351, cpi: 111.2 },
  { year: 1988, sp500NominalReturn: 0.179599, sp500RealReturn: 0.126999, tenYearTreasuryReturn: 0.061969, cpi: 115.7 },
  { year: 1989, sp500NominalReturn: 0.230107, sp500RealReturn: 0.169278, tenYearTreasuryReturn: 0.152685, cpi: 121.1 },
  { year: 1990, sp500NominalReturn: -0.008277, sp500RealReturn: -0.061326, tenYearTreasuryReturn: 0.097304, cpi: 127.4 },
  { year: 1991, sp500NominalReturn: 0.31956, sp500RealReturn: 0.286117, tenYearTreasuryReturn: 0.16326, cpi: 134.6 },
  { year: 1992, sp500NominalReturn: 0.077425, sp500RealReturn: 0.043425, tenYearTreasuryReturn: 0.105266, cpi: 138.1 },
  { year: 1993, sp500NominalReturn: 0.117099, sp500RealReturn: 0.089592, tenYearTreasuryReturn: 0.128193, cpi: 142.6 },
  { year: 1994, sp500NominalReturn: 0.011625, sp500RealReturn: -0.015971, tenYearTreasuryReturn: -0.073082, cpi: 146.2 },
  { year: 1995, sp500NominalReturn: 0.353293, sp500RealReturn: 0.317358, tenYearTreasuryReturn: 0.243504, cpi: 150.3 },
  { year: 1996, sp500NominalReturn: 0.273799, sp500RealReturn: 0.236169, tenYearTreasuryReturn: -0.005264, cpi: 154.4 },
  { year: 1997, sp500NominalReturn: 0.279168, sp500RealReturn: 0.259379, tenYearTreasuryReturn: 0.150144, cpi: 159.1 },
  { year: 1998, sp500NominalReturn: 0.315153, sp500RealReturn: 0.29354, tenYearTreasuryReturn: 0.122114, cpi: 161.6 },
  { year: 1999, sp500NominalReturn: 0.155788, sp500RealReturn: 0.124977, tenYearTreasuryReturn: -0.086709, cpi: 164.3 },
  { year: 2000, sp500NominalReturn: -0.052137, sp500RealReturn: -0.086241, tenYearTreasuryReturn: 0.18663, cpi: 168.8 },
  { year: 2001, sp500NominalReturn: -0.134734, sp500RealReturn: -0.144505, tenYearTreasuryReturn: 0.060409, cpi: 175.1 },
  { year: 2002, sp500NominalReturn: -0.201255, sp500RealReturn: -0.221477, tenYearTreasuryReturn: 0.131814, cpi: 177.1 },
  { year: 2003, sp500NominalReturn: 0.285842, sp500RealReturn: 0.261541, tenYearTreasuryReturn: 0.031009, cpi: 181.7 },
  { year: 2004, sp500NominalReturn: 0.060602, sp500RealReturn: 0.030013, tenYearTreasuryReturn: 0.036807, cpi: 185.2 },
  { year: 2005, sp500NominalReturn: 0.101416, sp500RealReturn: 0.059203, tenYearTreasuryReturn: 0.026671, cpi: 190.7 },
  { year: 2006, sp500NominalReturn: 0.133949, sp500RealReturn: 0.110891, tenYearTreasuryReturn: 0.020747, cpi: 198.3 },
  { year: 2007, sp500NominalReturn: -0.014236, sp500RealReturn: -0.054698, tenYearTreasuryReturn: 0.136037, cpi: 202.416 },
  { year: 2008, sp500NominalReturn: -0.356304, sp500RealReturn: -0.356496, tenYearTreasuryReturn: 0.147711, cpi: 211.08 },
  { year: 2009, sp500NominalReturn: 0.332576, sp500RealReturn: 0.298481, tenYearTreasuryReturn: -0.068747, cpi: 211.143 },
  { year: 2010, sp500NominalReturn: 0.163875, sp500RealReturn: 0.145187, tenYearTreasuryReturn: 0.060972, cpi: 216.687 },
  { year: 2011, sp500NominalReturn: 0.03408, sp500RealReturn: 0.004691, tenYearTreasuryReturn: 0.16151, cpi: 220.223 },
  { year: 2012, sp500NominalReturn: 0.16226, sp500RealReturn: 0.144014, tenYearTreasuryReturn: 0.023226, cpi: 226.665 },
  { year: 2013, sp500NominalReturn: 0.256086, sp500RealReturn: 0.236562, tenYearTreasuryReturn: -0.059099, cpi: 230.28 },
  { year: 2014, sp500NominalReturn: 0.13479, sp500RealReturn: 0.135805, tenYearTreasuryReturn: 0.117725, cpi: 233.916 },
  { year: 2015, sp500NominalReturn: -0.034418, sp500RealReturn: -0.047497, tenYearTreasuryReturn: 0.00209, cpi: 233.707 },
  { year: 2016, sp500NominalReturn: 0.211129, sp500RealReturn: 0.181588, tenYearTreasuryReturn: -0.012519, cpi: 236.916 },
  { year: 2017, sp500NominalReturn: 0.249941, sp500RealReturn: 0.224586, tenYearTreasuryReturn: 0.009945, cpi: 242.839 },
  { year: 2018, sp500NominalReturn: -0.047478, sp500RealReturn: -0.062028, tenYearTreasuryReturn: 0.017521, cpi: 247.867 },
  { year: 2019, sp500NominalReturn: 0.281501, sp500RealReturn: 0.250409, tenYearTreasuryReturn: 0.11034, cpi: 251.712 },
  { year: 2020, sp500NominalReturn: 0.178649, sp500RealReturn: 0.162379, tenYearTreasuryReturn: 0.073093, cpi: 257.971 },
  { year: 2021, sp500NominalReturn: 0.222143, sp500RealReturn: 0.137091, tenYearTreasuryReturn: -0.047918, cpi: 261.582 },
  { year: 2022, sp500NominalReturn: -0.120094, sp500RealReturn: -0.1731, tenYearTreasuryReturn: -0.118956, cpi: 281.148 },
];
