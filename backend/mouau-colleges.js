/**
 * Official College and Department configuration for
 * NACOME Election System — Department of Computer Engineering,
 * College of Engineering and Engineering Technology (CEET),
 * Michael Okpara University of Agriculture, Umudike (MOUAU)
 * Source: https://mouau.edu.ng
 */

const MOUAU_COLLEGES = [
    {
        code: 'CEET',
        name: 'College of Engineering and Engineering Technology (CEET)',
        depts: [
            'Computer Engineering'
        ]
    }
];

function findCollegeByDept(dept) {
    if (!dept) return null;
    const match = MOUAU_COLLEGES.find(c => c.depts.includes(dept));
    return match ? match.name : null;
}

module.exports = {
    MOUAU_COLLEGES,
    findCollegeByDept
};

