// KSKR = Vratno krilo
export default function kskr({ RED_VIS, RED_SIR, SKR_PROD, SPY_OFF, VAN_VRATA, SKRIV_ZAT, DUP_MET }) {
  const entities = [

{
          "type": "LINE",
          "segments": "0:5:8:10:20:30:11:21:31",
          "handle": "CB",
          "layer": "LINIJA_BRAVA",
          "startPoint": {
            "x": (2170.024+SKR_PROD)-VAN_VRATA,
            "y": 1054.049+RED_SIR,
            "z": 0
          },
          "endPoint": {
            "x": (67.995-RED_VIS)+SKRIV_ZAT,
            "y": 1054.049+RED_SIR,
            "z": 0
          }
        },
        {
          "type": "LINE",
          "segments": "0:5:8:10:20:30:11:21:31",
          "handle": "EC",
          "layer": "LINIJA_DNO_VRATA",
          "startPoint": {
            "x": (2170.024+SKR_PROD)-VAN_VRATA,
            "y": 0,
            "z": 0
          },
          "endPoint": {
            "x": (2170.024+SKR_PROD)-VAN_VRATA,
            "y": 43.012-DUP_MET,
            "z": 0
          }
        },
        {
          "type": "LINE",
          "segments": "0:5:8:10:20:30:11:21:31",
          "handle": "101",
          "layer": "BRAVA_PLUS",
          "startPoint": {
            "x": 1209.524,
            "y": 893.024,
            "z": 0
          },
          "endPoint": {
            "x": 1209.524,
            "y": 953.024,
            "z": 0
          }
        },
        {
          "type": "LINE",
          "segments": "0:5:8:10:20:30:11:21:31",
          "handle": "102",
          "layer": "BRAVA_PLUS",
          "startPoint": {
            "x": 1209.524,
            "y": 953.024,
            "z": 0
          },
          "endPoint": {
            "x": 1264.524,
            "y": 953.024,
            "z": 0
          }
        },
        {
          "type": "LINE",
          "segments": "0:5:8:10:20:30:11:21:31",
          "handle": "103",
          "layer": "BRAVA_PLUS",
          "startPoint": {
            "x": 1264.524,
            "y": 953.024,
            "z": 0
          },
          "endPoint": {
            "x": 1264.524,
            "y": 893.024,
            "z": 0
          }
        },
        {
          "type": "LINE",
          "segments": "0:5:8:10:20:30:11:21:31",
          "handle": "104",
          "layer": "BRAVA_PLUS",
          "startPoint": {
            "x": 1264.524,
            "y": 893.024,
            "z": 0
          },
          "endPoint": {
            "x": 1209.524,
            "y": 893.024,
            "z": 0
          }
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "105",
          "layer": "SPY",
          "startPoint": {
            "x": 720.024-SPY_OFF,
            "y": 527.024+(RED_SIR/2),
            "z": 0
          },
          "radius": 11
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "106",
          "layer": "KLIN",
          "startPoint": {
            "x": 1682.774,
            "y": 54.812,
            "z": 0
          },
          "radius": 5
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "107",
          "layer": "KLIN",
          "startPoint": {
            "x": 901.274,
            "y": 54.812,
            "z": 0
          },
          "radius": 5
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "108",
          "layer": "KLIN",
          "startPoint": {
            "x": 470.524,
            "y": 54.812,
            "z": 0
          },
          "radius": 5
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "109",
          "layer": "KLIN",
          "startPoint": {
            "x": 1282.024,
            "y": 54.812,
            "z": 0
          },
          "radius": 5
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "10A",
          "layer": "KLIN_DONJI",
          "startPoint": {
            "x": 2080.524,
            "y": 54.812,
            "z": 0
          },
          "radius": 5
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "12A",
          "layer": "OZNAKA_VAN_ZAT",
          "startPoint": {
            "x": (25-RED_VIS)+SKRIV_ZAT,
            "y": 384.025,
            "z": 0
          },
          "radius": 2
        },
        {
          "type": "LINE",
          "segments": "0:5:8:10:20:30:11:21:31",
          "handle": "18C",
          "layer": "LINIJA_BRITVELA",
          "startPoint": {
            "x": (2170.024+SKR_PROD)-VAN_VRATA,
            "y": 0,
            "z": 0
          },
          "endPoint": {
            "x": (67.995-RED_VIS)+SKRIV_ZAT,
            "y": 0,
            "z": 0
          }
        },
        {
          "type": "LINE",
          "segments": "0:5:8:10:20:30:11:21:31",
          "handle": "1F2",
          "layer": "LINIJA_DNO_VRATA",
          "startPoint": {
            "x": (2170.024+SKR_PROD)-VAN_VRATA,
            "y": 1054.049+RED_SIR,
            "z": 0
          },
          "endPoint": {
            "x": (2170.024+SKR_PROD)-VAN_VRATA,
            "y": 68.012,
            "z": 0
          }
        },
        {
          "type": "LINE",
          "segments": "0:5:8:10:20:30:11:21:31",
          "handle": "1F3",
          "layer": "LINIJA_HORIZONTALA",
          "startPoint": {
            "x": (0-RED_VIS)+SKRIV_ZAT,
            "y": 1007.125+RED_SIR,
            "z": 0
          },
          "endPoint": {
            "x": (0-RED_VIS)+SKRIV_ZAT,
            "y": 46.924,
            "z": 0
          }
        },
        {
          "type": "LINE",
          "segments": "0:5:8:10:20:30:11:21:31",
          "handle": "7FD",
          "layer": "NEMA_METLICA",
          "startPoint": {
            "x": (2170.024+SKR_PROD)-VAN_VRATA,
            "y": 68.012,
            "z": 0
          },
          "endPoint": {
            "x": (2170.024+SKR_PROD)-VAN_VRATA,
            "y": 43.012,
            "z": 0
          }
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "C32",
          "layer": "LIMITATOR",
          "startPoint": {
            "x": 762.024,
            "y": 1007.036+RED_SIR,
            "z": 0
          },
          "radius": 12.5
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "13B5",
          "layer": "FI8_PEGLA_BRITVELA",
          "startPoint": {
            "x": (2083.024+SKR_PROD)-VAN_VRATA,
            "y": 10,
            "z": 0
          },
          "radius": 4
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "13B6",
          "layer": "FI8_PEGLA_BRITVELA",
          "startPoint": {
            "x": (131.924-RED_VIS)+SKRIV_ZAT,
            "y": 10,
            "z": 0
          },
          "radius": 4
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "13B7",
          "layer": "FI8_PEGLA_HORIZONTALA",
          "startPoint": {
            "x": (11-RED_VIS)+SKRIV_ZAT,
            "y": 130.924,
            "z": 0
          },
          "radius": 4
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "13B8",
          "layer": "FI8_PEGLA_HORIZONTALA",
          "startPoint": {
            "x": (11-RED_VIS)+SKRIV_ZAT,
            "y": 923.125+RED_SIR,
            "z": 0
          },
          "radius": 4
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "13B9",
          "layer": "FI8_PEGLA_BRAVA",
          "startPoint": {
            "x": (2083.024+SKR_PROD)-VAN_VRATA,
            "y": 1044.049+RED_SIR,
            "z": 0
          },
          "radius": 4
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "13BA",
          "layer": "FI8_PEGLA_BRAVA",
          "startPoint": {
            "x": (131.924-RED_VIS)+SKRIV_ZAT,
            "y": 1044.049+RED_SIR,
            "z": 0
          },
          "radius": 4
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "13BB",
          "layer": "FI8_PEGLA_DNO_VRATA",
          "startPoint": {
            "x": (2157.024+SKR_PROD)-VAN_VRATA,
            "y": 923.02+RED_SIR,
            "z": 0
          },
          "radius": 4
        },
        {
          "type": "CIRCLE",
          "segments": "0:5:8:10:20:30:40",
          "handle": "13BC",
          "layer": "FI8_PEGLA_DNO_VRATA",
          "startPoint": {
            "x": (2157.024+SKR_PROD)-VAN_VRATA,
            "y": 131.02,
            "z": 0
          },
          "radius": 4
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "1413",
          "layer": "IZBACAJ_LIJEVI",
          "name": "IZBACAJ_LIJEVI",
          "startPoint": {
            "x": (0-RED_VIS)+SKRIV_ZAT,
            "y": 0,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "141C",
          "layer": "IZBACAJ_DESNI",
          "name": "IZBACAJ_DESNI",
          "startPoint": {
            "x": (0-RED_VIS)+SKRIV_ZAT,
            "y": 0+RED_SIR,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "143D",
          "layer": "SKRIV_ZAT",
          "name": "SKRIV_ZAT",
          "startPoint": {
            "x": (0-RED_VIS)+SKRIV_ZAT,
            "y": 0,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "1457",
          "layer": "OZNAKA_LX",
          "name": "OZNAKA_LX",
          "startPoint": {
            "x": (0-SPY_OFF),
            "y": 0,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "1469",
          "layer": "OZNAKA_DX",
          "name": "OZNAKA_DX",
          "startPoint": {
            "x": (0-SPY_OFF),
            "y": 0,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "1470",
          "layer": "METLICA",
          "name": "METLICA",
          "startPoint": {
            "x": (0+SKR_PROD)-VAN_VRATA,
            "y": 0,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "1478",
          "layer": "BRITVELA_DONJA",
          "name": "BRITVELA_DONJA",
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "1480",
          "layer": "BRITVELA_GORNJA",
          "name": "BRITVELA_GORNJA",
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "1485",
          "layer": "3BRITVELA_GORNJA",
          "name": "3BRITVELA_GORNJA",
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "148D",
          "layer": "3BRITVELA_DONJA",
          "name": "3BRITVELA_DONJA",
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "1496",
          "layer": "FI4_HORIZONTALA",
          "name": "FI4_HORIZONTALA",
          "startPoint": {
            "x": (0-RED_VIS)+SKRIV_ZAT,
            "y": 0,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "14A1",
          "layer": "FI4_BRAVA",
          "name": "FI4_BRAVA",
          "startPoint": {
            "x": 0,
            "y": 0+RED_SIR,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "14AE",
          "layer": "FI4_BRITVELA",
          "name": "FI4_BRITVELA",
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "14BA",
          "layer": "DEVIATOR",
          "name": "DEVIATOR",
          "startPoint": {
            "x": 0,
            "y": 0+RED_SIR,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "14C6",
          "layer": "DUPLI_DEVIATOR",
          "name": "DUPLI_DEVIATOR",
          "startPoint": {
            "x": 0,
            "y": 0+RED_SIR,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "14D0",
          "layer": "COMFORTLOCK",
          "name": "COMFORTLOCK",
          "startPoint": {
            "x": 0,
            "y": 0+RED_SIR,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "14EB",
          "layer": "BRAVA",
          "name": "BRAVA",
          "startPoint": {
            "x": 0,
            "y": 0+RED_SIR,
            "z": 0
          }
        },
        {
          "type": "INSERT",
          "segments": "0:5:8:2:10:20:30",
          "handle": "15BF",
          "layer": "PANIC_BRAVA",
          "name": "PANIC_BRAVA",
          "startPoint": {
            "x": 0,
            "y": 0+(RED_SIR/2),
            "z": 0
          }
        },
    {
          "type": "INSERT",
          "segments": "0:5:8:6:2:10:20:30",
          "handle": "3F4",
          "layer": "0",
          "lineType": "CONTINUOUS",
          "name": "RUKOHVAT",
          "startPoint": {
            "x": (0-RED_VIS)+SKRIV_ZAT,
            "y": 0+RED_SIR,
            "z": 0
          }
        }
      ];






 const blocks = [


 {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [],
          "layer": "0",
          "name": "$MODEL_SPACE",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "$MODEL_SPACE",
          "primaryText": ""
        },
        {
          "segments": "0:67:8:2:70:10:20:30:3:1",
          "entities": [],
          "inPaperSpace": 1,
          "layer": "0",
          "name": "$PAPER_SPACE",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "$PAPER_SPACE",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "979",
              "layer": "0",
              "startPoint": {
                "x": 0,
                "y": 0,
                "z": 0
              },
              "radius": 1.5
            }
          ],
          "layer": "0",
          "name": "*U65",
          "undefined": 1,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "*U65",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "986",
              "layer": "0",
              "startPoint": {
                "x": 0,
                "y": 0,
                "z": 0
              },
              "radius": 1.5
            }
          ],
          "layer": "0",
          "name": "*U67",
          "undefined": 1,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "*U67",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "9B1",
              "layer": "0",
              "startPoint": {
                "x": 0,
                "y": 0.068,
                "z": 0
              },
              "radius": 1.5
            }
          ],
          "layer": "0",
          "name": "*U71",
          "undefined": 1,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "*U71",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "10FE",
              "layer": "0",
              "startPoint": {
                "x": 0,
                "y": 0,
                "z": 0
              },
              "radius": 1.5
            }
          ],
          "layer": "0",
          "name": "*U111",
          "undefined": 1,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "*U111",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "110B",
              "layer": "0",
              "startPoint": {
                "x": 0,
                "y": 0,
                "z": 0
              },
              "radius": 1.5
            }
          ],
          "layer": "0",
          "name": "*U113",
          "undefined": 1,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "*U113",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "113B",
              "layer": "0",
              "startPoint": {
                "x": 0,
                "y": 0.068,
                "z": 0
              },
              "radius": 1.5
            }
          ],
          "layer": "0",
          "name": "*U116",
          "undefined": 1,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "*U116",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "116A",
              "layer": "0",
              "startPoint": {
                "x": 0,
                "y": 0.068,
                "z": 0
              },
              "radius": 1.5
            }
          ],
          "layer": "0",
          "name": "*U119",
          "undefined": 1,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "*U119",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "INSERT",
              "segments": "0:5:8:6:62:2:10:20:30:50",
              "handle": "116E",
              "layer": "OZNAKA_LX",
              "lineType": "BYBLOCK",
              "colorIndex": 0,
              "name": "*U119",
              "startPoint": {
                "x": 781.755,
                "y": -1071.716891435645,
                "z": 0
              },
              "startAngle": 90
            },
            {
              "type": "INSERT",
              "segments": "0:5:8:6:62:2:10:20:30:50",
              "handle": "116F",
              "layer": "OZNAKA_LX",
              "lineType": "BYBLOCK",
              "colorIndex": 0,
              "name": "*U119",
              "startPoint": {
                "x": 781.755,
                "y": -1060.716891435645,
                "z": 0
              },
              "startAngle": 90
            },
            {
              "type": "INSERT",
              "segments": "0:5:8:6:62:2:10:20:30:50",
              "handle": "1170",
              "layer": "OZNAKA_LX",
              "lineType": "BYBLOCK",
              "colorIndex": 0,
              "name": "*U119",
              "startPoint": {
                "x": 781.755,
                "y": -1049.716891435645,
                "z": 0
              },
              "startAngle": 90
            },
            {
              "type": "INSERT",
              "segments": "0:5:8:6:62:2:10:20:30:50",
              "handle": "1171",
              "layer": "OZNAKA_LX",
              "lineType": "BYBLOCK",
              "colorIndex": 0,
              "name": "*U119",
              "startPoint": {
                "x": 781.755,
                "y": -1038.716891435645,
                "z": 0
              },
              "startAngle": 90
            }
          ],
          "layer": "0",
          "name": "*U120",
          "undefined": 1,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "*U120",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1390",
              "layer": "0",
              "startPoint": {
                "x": 0,
                "y": 0.068,
                "z": 0
              },
              "radius": 1.5
            }
          ],
          "layer": "0",
          "name": "*U130",
          "undefined": 1,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "*U130",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "140E",
              "layer": "IZBACAJ_LIJEVI",
              "startPoint": {
                "x": 0,
                "y": 46.924,
                "z": 0
              },
              "endPoint": {
                "x": 20,
                "y": 46.924,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "140F",
              "layer": "IZBACAJ_LIJEVI",
              "startPoint": {
                "x": 20,
                "y": 46.924,
                "z": 0
              },
              "endPoint": {
                "x": 20,
                "y": 67.995,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "1410",
              "layer": "IZBACAJ_LIJEVI",
              "startPoint": {
                "x": 20,
                "y": 67.995,
                "z": 0
              },
              "endPoint": {
                "x": 66.273,
                "y": 67.995,
                "z": 0
              }
            },
            {
              "type": "ARC",
              "segments": "0:5:8:10:20:30:40:50:51",
              "handle": "1411",
              "layer": "IZBACAJ_LIJEVI",
              "startPoint": {
                "x": 68.018,
                "y": 67.018,
                "z": 0
              },
              "radius": 2,
              "startAngle": 269.341,
              "endAngle": 150.758
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "1412",
              "layer": "IZBACAJ_LIJEVI",
              "startPoint": {
                "x": 67.995,
                "y": 65.018,
                "z": 0
              },
              "endPoint": {
                "x": 67.995,
                "y": 0,
                "z": 0
              }
            }
          ],
          "layer": "0",
          "name": "IZBACAJ_LIJEVI",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "IZBACAJ_LIJEVI",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "1420",
              "layer": "IZBACAJ_DESNI",
              "startPoint": {
                "x": 67.995,
                "y": 1054.049,
                "z": 0
              },
              "endPoint": {
                "x": 67.995,
                "y": 989.031,
                "z": 0
              }
            },
            {
              "type": "ARC",
              "segments": "0:5:8:10:20:30:40:50:51",
              "handle": "1421",
              "layer": "IZBACAJ_DESNI",
              "startPoint": {
                "x": 68.018,
                "y": 987.031,
                "z": 0
              },
              "radius": 2,
              "startAngle": 209.242,
              "endAngle": 90.659
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "1422",
              "layer": "IZBACAJ_DESNI",
              "startPoint": {
                "x": 66.273,
                "y": 986.054,
                "z": 0
              },
              "endPoint": {
                "x": 20,
                "y": 986.054,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "1423",
              "layer": "IZBACAJ_DESNI",
              "startPoint": {
                "x": 20,
                "y": 986.054,
                "z": 0
              },
              "endPoint": {
                "x": 20,
                "y": 1007.125,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "1424",
              "layer": "IZBACAJ_DESNI",
              "startPoint": {
                "x": 20,
                "y": 1007.125,
                "z": 0
              },
              "endPoint": {
                "x": 0,
                "y": 1007.125,
                "z": 0
              }
            }
          ],
          "layer": "0",
          "name": "IZBACAJ_DESNI",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "IZBACAJ_DESNI",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "1437",
              "layer": "SKRIV_ZAT",
              "startPoint": {
                "x": 31.012,
                "y": 440.524,
                "z": 0
              },
              "endPoint": {
                "x": 67.312,
                "y": 440.524,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "1438",
              "layer": "SKRIV_ZAT",
              "startPoint": {
                "x": 67.312,
                "y": 440.524,
                "z": 0
              },
              "endPoint": {
                "x": 67.312,
                "y": 94.524,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "1439",
              "layer": "SKRIV_ZAT",
              "startPoint": {
                "x": 67.312,
                "y": 94.524,
                "z": 0
              },
              "endPoint": {
                "x": 31.012,
                "y": 94.524,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "143A",
              "layer": "SKRIV_ZAT",
              "startPoint": {
                "x": 31.012,
                "y": 94.524,
                "z": 0
              },
              "endPoint": {
                "x": 31.012,
                "y": 440.524,
                "z": 0
              }
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "143B",
              "layer": "SKRIV_ZAT",
              "startPoint": {
                "x": 92.924,
                "y": 417.524,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "143C",
              "layer": "SKRIV_ZAT",
              "startPoint": {
                "x": 92.924,
                "y": 117.524,
                "z": 0
              },
              "radius": 4
            }
          ],
          "layer": "0",
          "name": "SKRIV_ZAT",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "SKRIV_ZAT",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "144E",
              "layer": "OZNAKA_LX",
              "startPoint": {
                "x": 570.657,
                "y": 500.963,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "144F",
              "layer": "OZNAKA_LX",
              "startPoint": {
                "x": 580.657,
                "y": 500.963,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1450",
              "layer": "OZNAKA_LX",
              "startPoint": {
                "x": 590.657,
                "y": 500.963,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1451",
              "layer": "OZNAKA_LX",
              "startPoint": {
                "x": 600.657,
                "y": 500.963,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1452",
              "layer": "OZNAKA_LX",
              "startPoint": {
                "x": 610.657,
                "y": 500.963,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1453",
              "layer": "OZNAKA_LX",
              "startPoint": {
                "x": 620.657,
                "y": 500.963,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1454",
              "layer": "OZNAKA_LX",
              "startPoint": {
                "x": 620.657,
                "y": 489.963,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1455",
              "layer": "OZNAKA_LX",
              "startPoint": {
                "x": 620.657,
                "y": 478.963,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1456",
              "layer": "OZNAKA_LX",
              "startPoint": {
                "x": 620.657,
                "y": 467.963,
                "z": 0
              },
              "radius": 1.5
            }
          ],
          "layer": "0",
          "name": "OZNAKA_LX",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "OZNAKA_LX",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "145B",
              "layer": "OZNAKA_DX",
              "startPoint": {
                "x": 619.346,
                "y": 562.757,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "145C",
              "layer": "OZNAKA_DX",
              "startPoint": {
                "x": 569.185,
                "y": 552.757,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "145D",
              "layer": "OZNAKA_DX",
              "startPoint": {
                "x": 579.185,
                "y": 552.757,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "145E",
              "layer": "OZNAKA_DX",
              "startPoint": {
                "x": 589.185,
                "y": 552.757,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "145F",
              "layer": "OZNAKA_DX",
              "startPoint": {
                "x": 599.185,
                "y": 552.757,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1460",
              "layer": "OZNAKA_DX",
              "startPoint": {
                "x": 609.185,
                "y": 552.757,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1461",
              "layer": "OZNAKA_DX",
              "startPoint": {
                "x": 619.185,
                "y": 552.757,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1462",
              "layer": "OZNAKA_DX",
              "startPoint": {
                "x": 569.185,
                "y": 562.757,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1463",
              "layer": "OZNAKA_DX",
              "startPoint": {
                "x": 574.59,
                "y": 569.906,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1464",
              "layer": "OZNAKA_DX",
              "startPoint": {
                "x": 581.953,
                "y": 575.016,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1465",
              "layer": "OZNAKA_DX",
              "startPoint": {
                "x": 590.542,
                "y": 577.577,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1466",
              "layer": "OZNAKA_DX",
              "startPoint": {
                "x": 599.501,
                "y": 577.336,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1467",
              "layer": "OZNAKA_DX",
              "startPoint": {
                "x": 607.939,
                "y": 574.316,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1468",
              "layer": "OZNAKA_DX",
              "startPoint": {
                "x": 615.016,
                "y": 568.817,
                "z": 0
              },
              "radius": 1.5
            }
          ],
          "layer": "0",
          "name": "OZNAKA_DX",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "OZNAKA_DX",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "146D",
              "layer": "METLICA",
              "startPoint": {
                "x": 2170.024,
                "y": 43.012-DUP_MET,
                "z": 0
              },
              "endPoint": {
                "x": 2137.024,
                "y": 43.012-DUP_MET,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "146E",
              "layer": "METLICA",
              "startPoint": {
                "x": 2137.024,
                "y": 43.012-DUP_MET,
                "z": 0
              },
              "endPoint": {
                "x": 2137.024,
                "y": 68.012,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "146F",
              "layer": "METLICA",
              "startPoint": {
                "x": 2137.024,
                "y": 68.012,
                "z": 0
              },
              "endPoint": {
                "x": 2170.024,
                "y": 68.012,
                "z": 0
              }
            }
          ],
          "layer": "0",
          "name": "METLICA",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "METLICA",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "1474",
              "layer": "BRITVELA_DONJA",
              "startPoint": {
                "x": 1790.024,
                "y": 37.012,
                "z": 0
              },
              "endPoint": {
                "x": 1856.024,
                "y": 37.012,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "1475",
              "layer": "BRITVELA_DONJA",
              "startPoint": {
                "x": 1856.024,
                "y": 37.012,
                "z": 0
              },
              "endPoint": {
                "x": 1856.024,
                "y": 7,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "1476",
              "layer": "BRITVELA_DONJA",
              "startPoint": {
                "x": 1856.024,
                "y": 7,
                "z": 0
              },
              "endPoint": {
                "x": 1790.024,
                "y": 7,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "1477",
              "layer": "BRITVELA_DONJA",
              "startPoint": {
                "x": 1790.024,
                "y": 7,
                "z": 0
              },
              "endPoint": {
                "x": 1790.024,
                "y": 37.012,
                "z": 0
              }
            }
          ],
          "layer": "0",
          "name": "BRITVELA_DONJA",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "BRITVELA_DONJA",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "147C",
              "layer": "BRITVELA_GORNJA",
              "startPoint": {
                "x": 288.724,
                "y": 37.012,
                "z": 0
              },
              "endPoint": {
                "x": 354.724,
                "y": 37.012,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "147D",
              "layer": "BRITVELA_GORNJA",
              "startPoint": {
                "x": 354.724,
                "y": 37.012,
                "z": 0
              },
              "endPoint": {
                "x": 354.724,
                "y": 7,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "147E",
              "layer": "BRITVELA_GORNJA",
              "startPoint": {
                "x": 354.724,
                "y": 7,
                "z": 0
              },
              "endPoint": {
                "x": 288.724,
                "y": 7,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "147F",
              "layer": "BRITVELA_GORNJA",
              "startPoint": {
                "x": 288.724,
                "y": 7,
                "z": 0
              },
              "endPoint": {
                "x": 288.724,
                "y": 37.012,
                "z": 0
              }
            }
          ],
          "layer": "0",
          "name": "BRITVELA_GORNJA",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "BRITVELA_GORNJA",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "17EC",
              "layer": "3BRITVELA_GORNJA",
              "startPoint": {
                "x": 98.724,
                "y": 37.012,
                "z": 0
              },
              "endPoint": {
                "x": 164.724,
                "y": 37.012,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "17ED",
              "layer": "3BRITVELA_GORNJA",
              "startPoint": {
                "x": 164.724,
                "y": 37.012,
                "z": 0
              },
              "endPoint": {
                "x": 164.724,
                "y": 7,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "17EE",
              "layer": "3BRITVELA_GORNJA",
              "startPoint": {
                "x": 164.724,
                "y": 7,
                "z": 0
              },
              "endPoint": {
                "x": 98.724,
                "y": 7,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "17EF",
              "layer": "3BRITVELA_GORNJA",
              "startPoint": {
                "x": 98.724,
                "y": 7,
                "z": 0
              },
              "endPoint": {
                "x": 98.724,
                "y": 37.012,
                "z": 0
              }
            }
          ],
          "layer": "0",
          "name": "3BRITVELA_GORNJA",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "3BRITVELA_GORNJA",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "1489",
              "layer": "3BRITVELA_DONJA",
              "startPoint": {
                "x": 538.724,
                "y": 37.012,
                "z": 0
              },
              "endPoint": {
                "x": 604.724,
                "y": 37.012,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "148A",
              "layer": "3BRITVELA_DONJA",
              "startPoint": {
                "x": 604.724,
                "y": 37.012,
                "z": 0
              },
              "endPoint": {
                "x": 604.724,
                "y": 7,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "148B",
              "layer": "3BRITVELA_DONJA",
              "startPoint": {
                "x": 604.724,
                "y": 7,
                "z": 0
              },
              "endPoint": {
                "x": 538.724,
                "y": 7,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "148C",
              "layer": "3BRITVELA_DONJA",
              "startPoint": {
                "x": 538.724,
                "y": 7,
                "z": 0
              },
              "endPoint": {
                "x": 538.724,
                "y": 37.012,
                "z": 0
              }
            }
          ],
          "layer": "0",
          "name": "3BRITVELA_DONJA",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "3BRITVELA_DONJA",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1491",
              "layer": "FI4_HORIZONTALA",
              "startPoint": {
                "x": 10,
                "y": 954.125+RED_SIR,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1492",
              "layer": "FI4_HORIZONTALA",
              "startPoint": {
                "x": 10,
                "y": 527.024+(RED_SIR/2),
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1493",
              "layer": "FI4_HORIZONTALA",
              "startPoint": {
                "x": 10,
                "y": 369.025,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1494",
              "layer": "FI4_HORIZONTALA",
              "startPoint": {
                "x": 10,
                "y": 685.024,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "1495",
              "layer": "FI4_HORIZONTALA",
              "startPoint": {
                "x": 10,
                "y": 99.924,
                "z": 0
              },
              "radius": 2
            }
          ],
          "layer": "0",
          "name": "FI4_HORIZONTALA",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "FI4_HORIZONTALA",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "149A",
              "layer": "FI4_BRAVA",
              "startPoint": {
                "x": 1825.857,
                "y": 1045.049,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "149B",
              "layer": "FI4_BRAVA",
              "startPoint": {
                "x": 958.357,
                "y": 1045.049,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "149C",
              "layer": "FI4_BRAVA",
              "startPoint": {
                "x": 380.024,
                "y": 1045.049,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "149D",
              "layer": "FI4_BRAVA",
              "startPoint": {
                "x": 669.191,
                "y": 1045.049,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "149E",
              "layer": "FI4_BRAVA",
              "startPoint": {
                "x": 1247.524,
                "y": 1045.049,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "149F",
              "layer": "FI4_BRAVA",
              "startPoint": {
                "x": (2115.024+SKR_PROD)-VAN_VRATA,
                "y": 1045.049,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14A0",
              "layer": "FI4_BRAVA",
              "startPoint": {
                "x": (110.924-RED_VIS)+SKRIV_ZAT,
                "y": 1045.049,
                "z": 0
              },
              "radius": 2
            }
          ],
          "layer": "0",
          "name": "FI4_BRAVA",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "FI4_BRAVA",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14A5",
              "layer": "FI4_BRITVELA",
              "startPoint": {
                "x": 1896.024,
                "y": 9,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14A6",
              "layer": "FI4_BRITVELA",
              "startPoint": {
                "x": 1750.024,
                "y": 9,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14A7",
              "layer": "FI4_BRITVELA",
              "startPoint": {
                "x": 794.191,
                "y": 9,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14A8",
              "layer": "FI4_BRITVELA",
              "startPoint": {
                "x": 465.024,
                "y": 9,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14A9",
              "layer": "FI4_BRITVELA",
              "startPoint": {
                "x": 380.024,
                "y": 9,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14AA",
              "layer": "FI4_BRITVELA",
              "startPoint": {
                "x": 923.357,
                "y": 9,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14AB",
              "layer": "FI4_BRITVELA",
              "startPoint": {
                "x": 1357.524,
                "y": 9,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14AC",
              "layer": "FI4_BRITVELA",
              "startPoint": {
                "x": (2115.024+SKR_PROD)-VAN_VRATA,
                "y": 9,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14AD",
              "layer": "FI4_BRITVELA",
              "startPoint": {
                "x": (110.924-RED_VIS)+SKRIV_ZAT,
                "y": 9,
                "z": 0
              },
              "radius": 2
            }
          ],
          "layer": "0",
          "name": "FI4_BRITVELA",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "FI4_BRITVELA",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14B2",
              "layer": "DEVIATOR",
              "startPoint": {
                "x": 407.424,
                "y": 991.436,
                "z": 0
              },
              "endPoint": {
                "x": 407.424,
                "y": 1019.436,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14B3",
              "layer": "DEVIATOR",
              "startPoint": {
                "x": 407.424,
                "y": 1019.436,
                "z": 0
              },
              "endPoint": {
                "x": 432.624,
                "y": 1019.436,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14B4",
              "layer": "DEVIATOR",
              "startPoint": {
                "x": 432.624,
                "y": 1019.436,
                "z": 0
              },
              "endPoint": {
                "x": 432.624,
                "y": 991.436,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14B5",
              "layer": "DEVIATOR",
              "startPoint": {
                "x": 432.624,
                "y": 991.436,
                "z": 0
              },
              "endPoint": {
                "x": 407.424,
                "y": 991.436,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14B6",
              "layer": "DEVIATOR",
              "startPoint": {
                "x": 1897.624,
                "y": 1019.436,
                "z": 0
              },
              "endPoint": {
                "x": 1897.624,
                "y": 991.436,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14B7",
              "layer": "DEVIATOR",
              "startPoint": {
                "x": 1897.624,
                "y": 991.436,
                "z": 0
              },
              "endPoint": {
                "x": 1872.424,
                "y": 991.436,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14B8",
              "layer": "DEVIATOR",
              "startPoint": {
                "x": 1872.424,
                "y": 991.436,
                "z": 0
              },
              "endPoint": {
                "x": 1872.424,
                "y": 1019.436,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14B9",
              "layer": "DEVIATOR",
              "startPoint": {
                "x": 1872.424,
                "y": 1019.436,
                "z": 0
              },
              "endPoint": {
                "x": 1897.624,
                "y": 1019.436,
                "z": 0
              }
            }
          ],
          "layer": "0",
          "name": "DEVIATOR",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "DEVIATOR",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14BE",
              "layer": "DUPLI_DEVIATOR",
              "startPoint": {
                "x": 370.424,
                "y": 991.436,
                "z": 0
              },
              "endPoint": {
                "x": 370.424,
                "y": 1019.436,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14BF",
              "layer": "DUPLI_DEVIATOR",
              "startPoint": {
                "x": 370.424,
                "y": 1019.436,
                "z": 0
              },
              "endPoint": {
                "x": 395.624,
                "y": 1019.436,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14C0",
              "layer": "DUPLI_DEVIATOR",
              "startPoint": {
                "x": 395.624,
                "y": 1019.436,
                "z": 0
              },
              "endPoint": {
                "x": 395.624,
                "y": 991.436,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14C1",
              "layer": "DUPLI_DEVIATOR",
              "startPoint": {
                "x": 395.624,
                "y": 991.436,
                "z": 0
              },
              "endPoint": {
                "x": 370.424,
                "y": 991.436,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14C2",
              "layer": "DUPLI_DEVIATOR",
              "startPoint": {
                "x": 1934.624,
                "y": 1019.436,
                "z": 0
              },
              "endPoint": {
                "x": 1934.624,
                "y": 991.436,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14C3",
              "layer": "DUPLI_DEVIATOR",
              "startPoint": {
                "x": 1934.624,
                "y": 991.436,
                "z": 0
              },
              "endPoint": {
                "x": 1909.424,
                "y": 991.436,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14C4",
              "layer": "DUPLI_DEVIATOR",
              "startPoint": {
                "x": 1909.424,
                "y": 991.436,
                "z": 0
              },
              "endPoint": {
                "x": 1909.424,
                "y": 1019.436,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14C5",
              "layer": "DUPLI_DEVIATOR",
              "startPoint": {
                "x": 1909.424,
                "y": 1019.436,
                "z": 0
              },
              "endPoint": {
                "x": 1934.624,
                "y": 1019.436,
                "z": 0
              }
            }
          ],
          "layer": "0",
          "name": "DUPLI_DEVIATOR",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "DUPLI_DEVIATOR",
          "primaryText": ""
        },
        
 {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:6:62:10:20:30:40",
              "handle": "120",
              "layer": "COMFORTLOCK",
              "lineType": "CONTINUOUS",
              "colorIndex": 7,
              "startPoint": {
                "x": 972.024,
                "y": 948.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:6:62:10:20:30:40",
              "handle": "121",
              "layer": "COMFORTLOCK",
              "lineType": "CONTINUOUS",
              "colorIndex": 7,
              "startPoint": {
                "x": 1063.524,
                "y": 948.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:6:62:10:20:30:40",
              "handle": "122",
              "layer": "COMFORTLOCK",
              "lineType": "CONTINUOUS",
              "colorIndex": 7,
              "startPoint": {
                "x": 1155.024,
                "y": 948.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:6:62:10:20:30:40",
              "handle": "123",
              "layer": "COMFORTLOCK",
              "lineType": "CONTINUOUS",
              "colorIndex": 7,
              "startPoint": {
                "x": 1155.024,
                "y": 876.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:6:62:10:20:30:40",
              "handle": "124",
              "layer": "COMFORTLOCK",
              "lineType": "CONTINUOUS",
              "colorIndex": 7,
              "startPoint": {
                "x": 1063.524,
                "y": 876.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:6:62:10:20:30:40",
              "handle": "125",
              "layer": "COMFORTLOCK",
              "lineType": "CONTINUOUS",
              "colorIndex": 7,
              "startPoint": {
                "x": 972.024,
                "y": 876.024,
                "z": 0
              },
              "radius": 4
            }
          ],
          "layer": "COMFORTLOCK",
          "name": "BLK15",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "BLK15",
          "primaryText": ""
        },

        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14D4",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1082.024,
                "y": 953.024,
                "z": 0
              },
              "endPoint": {
                "x": 1152.024,
                "y": 953.024,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14D5",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1152.024,
                "y": 953.024,
                "z": 0
              },
              "endPoint": {
                "x": 1152.024,
                "y": 893.024,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14D6",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1152.024,
                "y": 893.024,
                "z": 0
              },
              "endPoint": {
                "x": 1082.024,
                "y": 893.024,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14D7",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1082.024,
                "y": 893.024,
                "z": 0
              },
              "endPoint": {
                "x": 1082.024,
                "y": 953.024,
                "z": 0
              }
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14D8",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1109.024,
                "y": 1005.536,
                "z": 0
              },
              "radius": 12.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14D9",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1053.024,
                "y": 1005.536,
                "z": 0
              },
              "radius": 12.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14DA",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1106.024,
                "y": 864.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14DB",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1017.024,
                "y": 972.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14DC",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1017.024,
                "y": 864.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14DD",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1195.024,
                "y": 972.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14DE",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1106.024,
                "y": 972.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14DF",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1195.024,
                "y": 864.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14E0",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1024.024,
                "y": 923.024,
                "z": 0
              },
              "radius": 11
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14E1",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1137.024,
                "y": 1005.536,
                "z": 0
              },
              "radius": 12.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "14E2",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1081.024,
                "y": 1005.536,
                "z": 0
              },
              "radius": 12.5
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14E3",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1178.524,
                "y": 1000.536,
                "z": 0
              },
              "endPoint": {
                "x": 1178.524,
                "y": 993.036,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14E4",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1178.524,
                "y": 993.036,
                "z": 0
              },
              "endPoint": {
                "x": 1151.524,
                "y": 993.036,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14E5",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1151.524,
                "y": 993.036,
                "z": 0
              },
              "endPoint": {
                "x": 1151.524,
                "y": 1022.036,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14E6",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1151.524,
                "y": 1022.036,
                "z": 0
              },
              "endPoint": {
                "x": 1178.524,
                "y": 1022.036,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14E7",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1178.524,
                "y": 1022.036,
                "z": 0
              },
              "endPoint": {
                "x": 1178.524,
                "y": 1010.536,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14E8",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1178.524,
                "y": 1010.536,
                "z": 0
              },
              "endPoint": {
                "x": 1187.024,
                "y": 1010.536,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14E9",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1187.024,
                "y": 1010.536,
                "z": 0
              },
              "endPoint": {
                "x": 1187.024,
                "y": 1000.536,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:10:20:30:11:21:31",
              "handle": "14EA",
              "layer": "BRAVA",
              "startPoint": {
                "x": 1187.024,
                "y": 1000.536,
                "z": 0
              },
              "endPoint": {
                "x": 1178.524,
                "y": 1000.536,
                "z": 0
              }
            }
          ],
          "layer": "0",
          "name": "BRAVA",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "BRAVA",
          "primaryText": ""
        },
        {
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "15B9",
              "layer": "PANIC_BRAVA",
              "startPoint": {
                "x": 956.524,
                "y": 923.024,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "15BA",
              "layer": "PANIC_BRAVA",
              "startPoint": {
                "x": 1002.524,
                "y": 923.024,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "15BB",
              "layer": "PANIC_BRAVA",
              "startPoint": {
                "x": 1045.524,
                "y": 923.024,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "15BC",
              "layer": "PANIC_BRAVA",
              "startPoint": {
                "x": 956.524,
                "y": 131.025,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "15BD",
              "layer": "PANIC_BRAVA",
              "startPoint": {
                "x": 1002.524,
                "y": 131.025,
                "z": 0
              },
              "radius": 1.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:10:20:30:40",
              "handle": "15BE",
              "layer": "PANIC_BRAVA",
              "startPoint": {
                "x": 1045.524,
                "y": 131.025,
                "z": 0
              },
              "radius": 1.5
            }
          ],
          "layer": "0",
          "name": "PANIC_BRAVA",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "PANIC_BRAVA",
          "primaryText": ""
        },
{
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:62:10:20:30:40",
              "handle": "26B",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 972.024,
                "y": 948.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:62:10:20:30:40",
              "handle": "26C",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1063.524,
                "y": 948.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:62:10:20:30:40",
              "handle": "26D",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1155.024,
                "y": 948.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:62:10:20:30:40",
              "handle": "26E",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1155.024,
                "y": 876.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:62:10:20:30:40",
              "handle": "26F",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1063.524,
                "y": 876.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:62:10:20:30:40",
              "handle": "270",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 972.024,
                "y": 876.024,
                "z": 0
              },
              "radius": 4
            },
            {
              "type": "LINE",
              "segments": "0:5:8:62:10:20:30:11:21:31",
              "handle": "271",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1082.024,
                "y": 893.024,
                "z": 0
              },
              "endPoint": {
                "x": 1149.024,
                "y": 893.024,
                "z": 0
              }
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:62:10:20:30:40",
              "handle": "272",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 986.5,
                "y": 1005.607,
                "z": 0
              },
              "radius": 5.5
            },
            {
              "type": "LINE",
              "segments": "0:5:8:62:10:20:30:11:21:31",
              "handle": "273",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1110.524,
                "y": 993.107,
                "z": 0
              },
              "endPoint": {
                "x": 1137.524,
                "y": 993.107,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:62:10:20:30:11:21:31",
              "handle": "274",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1137.524,
                "y": 1000.607,
                "z": 0
              },
              "endPoint": {
                "x": 1146.023,
                "y": 1000.607,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:62:10:20:30:11:21:31",
              "handle": "275",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1146.023,
                "y": 1000.607,
                "z": 0
              },
              "endPoint": {
                "x": 1146.023,
                "y": 1010.607,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:62:10:20:30:11:21:31",
              "handle": "276",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1146.023,
                "y": 1010.607,
                "z": 0
              },
              "endPoint": {
                "x": 1137.524,
                "y": 1010.607,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:62:10:20:30:11:21:31",
              "handle": "277",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1137.524,
                "y": 993.107,
                "z": 0
              },
              "endPoint": {
                "x": 1137.524,
                "y": 1000.607,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:62:10:20:30:11:21:31",
              "handle": "278",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1137.524,
                "y": 1010.607,
                "z": 0
              },
              "endPoint": {
                "x": 1137.524,
                "y": 1022.107,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:62:10:20:30:11:21:31",
              "handle": "279",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1110.524,
                "y": 1022.107,
                "z": 0
              },
              "endPoint": {
                "x": 1110.524,
                "y": 993.107,
                "z": 0
              }
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:62:10:20:30:40",
              "handle": "27A",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1012.024,
                "y": 1005.607,
                "z": 0
              },
              "radius": 12.5
            },
            {
              "type": "LINE",
              "segments": "0:5:8:62:10:20:30:11:21:31",
              "handle": "27B",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1137.524,
                "y": 1022.107,
                "z": 0
              },
              "endPoint": {
                "x": 1110.524,
                "y": 1022.107,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:62:10:20:30:11:21:31",
              "handle": "27C",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1149.024,
                "y": 893.024,
                "z": 0
              },
              "endPoint": {
                "x": 1149.024,
                "y": 953.024,
                "z": 0
              }
            },
            {
              "type": "LINE",
              "segments": "0:5:8:62:10:20:30:11:21:31",
              "handle": "27D",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1149.024,
                "y": 953.024,
                "z": 0
              },
              "endPoint": {
                "x": 1082.024,
                "y": 953.024,
                "z": 0
              }
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:62:10:20:30:40",
              "handle": "27E",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1040.024,
                "y": 1005.607,
                "z": 0
              },
              "radius": 12.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:62:10:20:30:40",
              "handle": "27F",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1068.024,
                "y": 1005.607,
                "z": 0
              },
              "radius": 12.5
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:62:10:20:30:40",
              "handle": "280",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1096.024,
                "y": 1005.607,
                "z": 0
              },
              "radius": 12.5
            },
            {
              "type": "LINE",
              "segments": "0:5:8:62:10:20:30:11:21:31",
              "handle": "281",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1082.024,
                "y": 953.024,
                "z": 0
              },
              "endPoint": {
                "x": 1082.024,
                "y": 893.024,
                "z": 0
              }
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:62:10:20:30:40",
              "handle": "282",
              "layer": "COMFORTLOCK",
              "colorIndex": 7,
              "startPoint": {
                "x": 1024.024,
                "y": 923.024,
                "z": 0
              },
              "radius": 12.5
            }
          ],
          "layer": "0",
          "name": "COMFORTLOCK",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "COMFORTLOCK",
          "primaryText": ""
        },
		{
          "segments": "0:8:2:70:10:20:30:3:1",
          "entities": [
            {
              "type": "CIRCLE",
              "segments": "0:5:8:6:10:20:30:40",
              "handle": "3F8",
              "layer": "RUKOHVAT",
              "lineType": "CONTINUOUS",
              "startPoint": {
                "x": 659,
                "y": 877,
                "z": 0
              },
              "radius": 2
            },
            {
              "type": "CIRCLE",
              "segments": "0:5:8:6:10:20:30:40",
              "handle": "3F9",
              "layer": "RUKOHVAT",
              "lineType": "CONTINUOUS",
              "startPoint": {
                "x": 1559,
                "y": 877,
                "z": 0
              },
              "radius": 2
            }
          ],
          "layer": "0",
          "name": "RUKOHVAT",
          "undefined": 0,
          "startPoint": {
            "x": 0,
            "y": 0,
            "z": 0
          },
          "otherText": "RUKOHVAT",
          "primaryText": ""
        },
 ];

  return {
    entities,
    blocks,
  };
}





